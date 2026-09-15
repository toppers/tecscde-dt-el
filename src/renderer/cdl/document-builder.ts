// TECSCDE-TS内部仕様 11.3 — CdlDocumentBuilder + ToolInfoValidator の結果を TecscdeDocument へ組み立てる
// （CdlDocumentLoader）。外部仕様5.3.2（読み込み時の未解決要素の扱い）・5.5.2（要素単位のレイアウト適用）・
// 8.1.2（複数ファイル読み込み時、最後の1つが編集対象・他は参照専用）を実装する。

import { alignRound } from "../model/align";
import { Cell } from "../model/cell";
import { CelltypeRef, type PortTemplate } from "../model/celltype";
import { asCellId, asJoinId, ROOT_REGION_ID, type CellId, type JoinId } from "../model/ids";
import { autoRouteBars, portPosition } from "../model/geometry";
import { Join, type Bar } from "../model/join";
import { PaperSpec } from "../model/paper";
import { CPort, EPort, type EdgeSide } from "../model/port";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import { TecscdeDocument } from "../model/document";
import { CdlDocumentBuilder, type CellDecl } from "./cst";
import { ToolInfoValidator, type ToolInfoTecscdeParsed } from "./tool-info";
import { compositeUnsupported, duplicateCell, missingJoinTarget, requirePortHidden, unresolvedCelltype } from "./messages";
import type { Diagnostic } from "../diagnostics/types";

export interface CdlSource {
  readonly text: string;
  readonly fileName: string;
  /** 8.1.2: 最後に選択／ドロップされたファイルのみtrue。他は参照専用。 */
  readonly editable: boolean;
}

export interface LoadResult {
  readonly document: TecscdeDocument;
  readonly diagnostics: readonly Diagnostic[];
}

function withLocation(d: Diagnostic, file: string): Diagnostic {
  return d.location ? { ...d, location: { ...d.location, file } } : d;
}

/** 外部仕様5.3.1の自動配置アルゴリズムをそのまま踏襲する（重なりを許して巻き戻す）。 */
function autoPlacementPosition(index: number, paperW: number, paperH: number): { x: number; y: number } {
  let x = 10;
  let y = 10;
  for (let i = 0; i < index; i += 1) {
    x += 55;
    if (x > paperW - 30) {
      x = 10;
      y += 30;
    }
    if (y > paperH - 15) {
      y = 10;
    }
  }
  return { x, y };
}

/**
 * セルタイプのポートに既定の辺・オフセットを割り当てる。
 * 「呼び口=左辺、受け口=右辺、辺の長さに均等配置」を既定方針とする
 * （外部仕様4.3.1のCPGap/EPGap=10mmという間隔の趣旨を、ポート数に応じて均等割りする形で踏襲）。
 */
function assignDefaultPortLayout(
  decls: readonly { readonly name: string; readonly signature: string; readonly arraySize?: number }[],
  edge: EdgeSide,
  edgeLength: number,
): PortTemplate[] {
  const count = decls.length;
  return decls.map((p, i) => ({
    name: p.name,
    signature: p.signature,
    edgeSide: edge,
    offset: alignRound((edgeLength * (i + 1)) / (count + 1)),
    subscript: null,
    arraySize: p.arraySize ?? null,
  }));
}

interface ParsedSource {
  readonly fileName: string;
  readonly editable: boolean;
  readonly cells: readonly CellDecl[];
}

export class CdlDocumentLoader {
  /**
   * 複数ファイルをまとめて読み込む（8.1.2）。編集対象ファイルのcellのみeditable=trueとなり、
   * セルタイプはどのファイルで定義されていても全ファイル分を解決対象として扱う。
   */
  static loadSources(sources: readonly CdlSource[]): LoadResult {
    const diagnostics: Diagnostic[] = [];
    const celltypes = new Map<string, CelltypeRef>();
    const parsedSources: ParsedSource[] = [];
    let preservedImports: readonly string[] = [];
    let toolInfoTecsgen: ToolInfoTecsgen = emptyToolInfoTecsgen();
    let tecscdeParsed: ToolInfoTecscdeParsed = { cellList: {}, joinList: {}, unknownFields: {} };
    let paper: PaperSpec = PaperSpec.default();

    for (const source of sources) {
      const { blocks, sourceWithBlanks } = ToolInfoValidator.extractBlocks(source.text);
      const parsed = CdlDocumentBuilder.build(sourceWithBlanks);
      for (const d of parsed.diagnostics) diagnostics.push(withLocation(d, source.fileName));
      for (const composite of parsed.composites) diagnostics.push(compositeUnsupported(composite.name));
      // 編集対象ファイルの import / import_C を原文のまま保持する（内部仕様3章）。
      if (source.editable) preservedImports = parsed.imports.map((i) => i.rawText);

      for (const block of blocks) {
        if (block.toolName === "tecsgen") {
          toolInfoTecsgen = ToolInfoValidator.parseTecsgen(block.json);
          const versionDiag = ToolInfoValidator.checkFormatVersion(toolInfoTecsgen);
          if (versionDiag) diagnostics.push(versionDiag);
        } else if (block.toolName === "tecscde") {
          const { parsed: p, diagnostics: d } = ToolInfoValidator.parseTecscde(block.json);
          tecscdeParsed = p;
          diagnostics.push(...d);
          if (p.paper) {
            paper = PaperSpec.create(p.paper.size, p.paper.orientation ?? "LANDSCAPE");
          }
        }
        // 5.1.1: 自分に向けられていないツール名のブロックは読み飛ばす。
      }

      for (const ct of parsed.celltypes) {
        const cportDecls = ct.ports.filter((p) => p.kind === "call" && !p.isRequire);
        const eportDecls = ct.ports.filter((p) => p.kind === "entry");
        const hiddenRequirePortCount = ct.ports.filter((p) => p.kind === "call" && p.isRequire).length;
        celltypes.set(
          ct.name,
          CelltypeRef.create({
            name: ct.name,
            cportTemplates: assignDefaultPortLayout(cportDecls, "LEFT", 15),
            eportTemplates: assignDefaultPortLayout(eportDecls, "RIGHT", 15),
            attributeNames: ct.attributes,
            hiddenRequirePortCount,
            locale: source.fileName,
          }),
        );
      }

      parsedSources.push({ fileName: source.fileName, editable: source.editable, cells: parsed.cells });
    }

    const { width: paperW, height: paperH } = paper.contentSize();

    // --- セル（1周目: 本体とポート。全ファイル分をまとめて処理する） ---
    const cells = new Map<CellId, Cell>();
    const seenNames = new Set<string>();
    let autoIndex = 0;

    for (const src of parsedSources) {
      for (const decl of src.cells) {
        if (seenNames.has(decl.cellName)) {
          diagnostics.push(duplicateCell(decl.cellName, { file: src.fileName, line: decl.line, column: decl.column }));
          continue;
        }
        seenNames.add(decl.cellName);
        const id = asCellId(decl.cellName);
        const celltype = celltypes.get(decl.celltypeName);
        const layout = tecscdeParsed.cellList[decl.cellName];

        let x: number;
        let y: number;
        let width: number;
        let height: number;
        if (layout) {
          [x, y, width, height] = layout.location;
        } else {
          const pos = autoPlacementPosition(autoIndex, paperW, paperH);
          autoIndex += 1;
          x = pos.x;
          y = pos.y;
          width = 25;
          height = 15;
        }

        const attrs: Record<string, string> = {};
        for (const a of decl.attrs) attrs[a.name] = a.expr;

        if (!celltype) {
          diagnostics.push(unresolvedCelltype(decl.cellName, id));
          cells.set(
            id,
            Cell.create({
              id,
              name: decl.cellName,
              celltypeName: decl.celltypeName,
              x,
              y,
              width,
              height,
              regionId: ROOT_REGION_ID, // RegionTreeへの割り当ては11.3の実装単位では未接続（全セルを根に置く）
              editable: src.editable,
              cports: [],
              eports: [],
              attrs,
              celltypeUnresolved: true,
              locale: src.fileName,
            }),
          );
          continue;
        }

        if (celltype.hiddenRequirePortCount > 0) {
          diagnostics.push(requirePortHidden(decl.cellName, celltype.hiddenRequirePortCount, id));
        }

        const applyPortLayout = (p: PortTemplate): PortTemplate => {
          const saved = layout?.ports?.[p.name];
          return saved ? { ...p, edgeSide: saved.edge, offset: saved.offset } : p;
        };

        const cports = celltype.cportTemplates.map((p) => {
          const t = applyPortLayout(p);
          return CPort.create({
            name: t.name,
            signature: t.signature,
            edgeSide: t.edgeSide,
            offset: t.offset,
            subscript: t.subscript,
            arraySize: t.arraySize,
          });
        });
        const eports = celltype.eportTemplates.map((p) => {
          const t = applyPortLayout(p);
          return EPort.create({
            name: t.name,
            signature: t.signature,
            edgeSide: t.edgeSide,
            offset: t.offset,
            subscript: t.subscript,
            arraySize: t.arraySize,
          });
        });

        cells.set(
          id,
          Cell.create({
            id,
            name: decl.cellName,
            celltypeName: decl.celltypeName,
            x,
            y,
            width,
            height,
            regionId: ROOT_REGION_ID,
            editable: src.editable,
            cports,
            eports,
            attrs,
            celltypeUnresolved: false,
            locale: src.fileName,
          }),
        );
      }
    }

    // --- 結合（2周目: 全セルが揃ってから解決） ---
    const joins = new Map<JoinId, Join>();
    for (const src of parsedSources) {
      for (const decl of src.cells) {
        const sourceCell = cells.get(asCellId(decl.cellName));
        if (!sourceCell) continue;
        for (const j of decl.joins) {
          const jid = asJoinId(`${decl.cellName}.${j.cport}${j.cportIndex !== undefined ? `[${j.cportIndex}]` : ""}`);
          const cport = sourceCell.cports.find((p) => p.name === j.cport && p.subscript === (j.cportIndex ?? null));
          const targetCell = cells.get(asCellId(j.targetCell));
          const eport = targetCell?.eports.find((p) => p.name === j.eport);
          if (!cport || !targetCell || !eport) {
            diagnostics.push(missingJoinTarget(decl.cellName, j.cport, sourceCell.id));
            continue;
          }

          const savedBars = tecscdeParsed.joinList[jid as unknown as string]?.bars;
          const bars: readonly Bar[] = savedBars
            ? savedBars.map((b) => ({ direction: b.dir, fixed: b.fixed, from: b.from, to: b.to }))
            : autoRouteBars(
                portPosition(sourceCell, cport),
                cport.edgeSide,
                portPosition(targetCell, eport),
                eport.edgeSide,
              );

          const join = Join.create(jid, sourceCell.id, cport, targetCell.id, eport, bars);
          joins.set(jid, join);

          const updatedSource = cells.get(sourceCell.id);
          if (updatedSource) {
            cells.set(sourceCell.id, updatedSource.withCPort(cport.withJoin(jid)));
          }
          const updatedTarget = cells.get(targetCell.id);
          if (updatedTarget) {
            const currentEport = updatedTarget.findEPort(eport.name) ?? eport;
            cells.set(targetCell.id, updatedTarget.withEPort(currentEport.withJoin(jid)));
          }
        }
      }
    }

    const editingSource = sources.find((s) => s.editable);
    const referenceFiles = sources.filter((s) => !s.editable).map((s) => s.fileName);

    const document = TecscdeDocument.build({
      cells,
      joins,
      celltypes,
      toolInfoTecsgen,
      paper,
      referenceFiles,
      editingFileName: editingSource?.fileName,
      unknownToolInfoTecscde: tecscdeParsed.unknownFields,
      preservedImports,
    });

    return { document, diagnostics };
  }

  /** 単一ファイル読み込みの簡便ラッパ（テスト・新規作成後の1ファイル読込用）。 */
  static loadSingle(text: string, fileName: string, editable = true): LoadResult {
    return CdlDocumentLoader.loadSources([{ text, fileName, editable }]);
  }
}

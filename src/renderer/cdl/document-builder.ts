// TECSCDE-TS内部仕様 11.3 / [[TECSCDE-DT-EL内部仕様]] 04B — CdlDocumentBuilder + ToolInfoValidator の結果を TecscdeDocument へ組み立てる（CdlDocumentLoader）
// （CdlDocumentLoader）。外部仕様5.3.2（読み込み時の未解決要素の扱い）・5.5.2（要素単位のレイアウト適用）・
// 8.1.2（複数ファイル読み込み時、最後の1つが編集対象・他は参照専用）を実装する。

import { alignRound } from "../model/align";
import { Cell } from "../model/cell";
import { CelltypeRef, type PortTemplate } from "../model/celltype";
import { asCellId, asJoinId, asRegionId, type CellId, type JoinId } from "../model/ids";
import { autoRouteBars, portPosition } from "../model/geometry";
import { Join, type Bar } from "../model/join";
import { PaperSpec } from "../model/paper";
import { CPort, EPort, type EdgeSide } from "../model/port";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import { TecscdeDocument, type CdlSourceTemplate } from "../model/document";
import { Region, RegionTree } from "../model/region";
import { CTypeRegistry, type TypeDefinition, type TypeResolution } from "../cdecl/type-registry";
import type { CdeclResult } from "../cdecl/extractor";
import { CdlDocumentBuilder, type CellDecl, type CelltypeDecl, type CompositeDecl, type GenerateDecl, type PortDecl, type SignatureDecl } from "./cst";
import { portTypeKey, type PortTypeIndex, type ResolvedPortType, type ResolvedSignatureType } from "./port-type-index";
import type { TypeUse } from "./signature-types";
import { ToolInfoValidator, type ToolInfoTecscdeParsed } from "./tool-info";
import { duplicateCell, missingJoinTarget, requirePortHidden, unresolvedCelltype, W_CODES } from "./messages";
import type { Diagnostic } from "../diagnostics/types";
import { isUnderAny } from "../../shared/path-under";

export interface CdlSource {
  readonly text: string;
  readonly fileName: string;
  readonly sourcePath?: string;
  /** 読み込んだCDLは編集可能。Plugin生成CDLは参照専用。 */
  readonly editable: boolean;
  /** Plugin-generated cells and types are read-only and are not saved or added to reference paths. */
  readonly generated?: boolean;
  /** ローダーが`systemDirs`から決める。`-S`のディレクトリ配下から読み込まれたCDLか（第3章3.2節）。 */
  readonly systemDefined?: boolean;
}

function isOrdinaryCelltype(decl: CelltypeDecl | CompositeDecl): decl is CelltypeDecl {
  return "qualifiedName" in decl;
}

export interface LoadResult {
  readonly document: TecscdeDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly portTypeIndex: PortTypeIndex;
}

export interface LoadOptions {
  readonly cdeclResults?: ReadonlyMap<string, CdeclResult>;
  /** `-S`で指定されたディレクトリ（絶対パス）。配下から読み込んだCDLを`systemDefined`とする（第3章3.2節）。 */
  readonly systemDirs?: readonly string[];
  /** `true`なら、`systemDefined`のセルも通常のCDLと同じく編集可能にする（既定は`false`）。 */
  readonly allowEditSystemDefined?: boolean;
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

/** generate のスコープから、既に読んだ署名の完全修飾名を探す。 */
function resolveGenerateSignature(
  declaration: GenerateDecl,
  signatures: ReadonlySet<string>,
): string | undefined {
  const name = declaration.signatureName.replace(/^::/, "");
  if (declaration.signatureName.startsWith("::")) return signatures.has(name) ? name : undefined;
  let scope = declaration.scopePath;
  while (scope !== "::") {
    const candidate = `${scope.slice(2)}::${name}`;
    if (signatures.has(candidate)) return candidate;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return signatures.has(name) ? name : undefined;
}

function resolveSignatureInScope(name: string, scopePath: string, signatures: ReadonlySet<string>): string | undefined {
  const normalized = name.replace(/^::/, "");
  if (name.startsWith("::")) return signatures.has(normalized) ? normalized : undefined;
  let scope = scopePath;
  while (scope !== "::") {
    const candidate = `${scope.slice(2)}::${normalized}`;
    if (signatures.has(candidate)) return candidate;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return signatures.has(normalized) ? normalized : undefined;
}

/** MrubyBridgeSignaturePlugin の外部インターフェースだけを表示モデルに反映する。 */
function registerMrubyBridgeCelltypes(
  celltypes: Map<string, CelltypeRef>,
  signatures: ReadonlySet<string>,
  declarations: readonly { readonly generate: GenerateDecl; readonly fileName: string }[],
): void {
  for (const { generate, fileName } of declarations) {
    if (generate.pluginName !== "MrubyBridgePlugin") continue;
    const signature = resolveGenerateSignature(generate, signatures);
    if (!signature) continue;
    const typeName = `t${signature.replace(/::/g, "_")}`;
    const bridgeName = `nMruby::${typeName}`;
    if (!celltypes.has(bridgeName)) {
      celltypes.set(bridgeName, CelltypeRef.create({
        name: bridgeName,
        cportTemplates: assignDefaultPortLayout([{ name: "cTECS", signature: `::${signature}` }], "LEFT", 15),
        eportTemplates: [],
        attributeNames: ["VMname", "bridgeName"],
        hiddenRequirePortCount: 0,
        locale: fileName,
      }));
    }
    const initializerName = `${bridgeName}_Initializer`;
    if (!celltypes.has(initializerName)) {
      celltypes.set(initializerName, CelltypeRef.create({
        name: initializerName,
        cportTemplates: [],
        eportTemplates: assignDefaultPortLayout([
          { name: "eInitialize", signature: "sInitializeTECSBridge" },
        ], "RIGHT", 15),
        attributeNames: [],
        hiddenRequirePortCount: 0,
        locale: fileName,
      }));
    }
  }
}

function resolveCelltypeInScope(
  celltypes: ReadonlyMap<string, CelltypeRef>,
  name: string,
  scopePath: string,
): CelltypeRef | undefined {
  const normalized = name.replace(/^::/, "");
  if (name.startsWith("::")) return celltypes.get(normalized);
  let scope = scopePath;
  while (scope !== "::") {
    const scoped = celltypes.get(`${scope.slice(2)}::${normalized}`);
    if (scoped) return scoped;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return celltypes.get(normalized);
}

interface ParsedSource {
  readonly fileName: string;
  readonly sourcePath?: string;
  readonly editable: boolean;
  readonly generated?: boolean;
  /** `-S`のディレクトリ配下から読み込まれたCDLか（セルの`systemDefined`と編集可否の元）。 */
  readonly systemDefined: boolean;
  readonly cells: readonly CellDecl[];
}

function buildRegionTree(paths: ReadonlySet<string>, cells: ReadonlyMap<CellId, Cell>): RegionTree {
  const childrenByPath = new Map<string, string[]>();
  for (const path of paths) {
    if (path === "::") continue;
    const lastSeparator = path.lastIndexOf("::");
    const parent = lastSeparator === 0 ? "::" : path.slice(0, lastSeparator);
    const children = childrenByPath.get(parent) ?? [];
    children.push(path);
    childrenByPath.set(parent, children);
  }
  const create = (path: string): Region => Region.create(
    asRegionId(path), path,
    (childrenByPath.get(path) ?? []).sort().map(create),
    [...cells.values()].filter((cell) => cell.regionId === path).map((cell) => cell.id),
  );
  return RegionTree.of(create("::"));
}

/** A comment immediately above a cell follows that cell when its region changes. */
function attachedCommentStart(source: string, cellStart: number): number {
  const cellLineStart = source.lastIndexOf("\n", cellStart - 1) + 1;
  let start = cellLineStart;
  while (start > 0) {
    const previousEnd = start - 1;
    const previousStart = source.lastIndexOf("\n", previousEnd - 1) + 1;
    const previousLine = source.slice(previousStart, previousEnd).trim();
    if (previousLine.startsWith("//")) {
      start = previousStart;
      continue;
    }
    if (previousLine.endsWith("*/")) {
      let blockStart = previousStart;
      while (blockStart > 0 && !source.slice(blockStart, previousEnd).trimStart().startsWith("/*")) {
        blockStart = source.lastIndexOf("\n", blockStart - 2) + 1;
      }
      if (source.slice(blockStart, previousEnd).trim().startsWith("/*")) {
        start = blockStart;
        continue;
      }
    }
    break;
  }
  return start === cellLineStart ? cellStart : start;
}

export class CdlDocumentLoader {
  /**
   * 複数ファイルをまとめて読み込む（8.1.2）。各セルの`editable`は、呼び出し側が渡す`CdlSource.editable`で決まる
   * （通常のCDLは全て編集可能、Plugin生成CDLは不可）。ただし`options.systemDirs`配下のCDLは、
   * `allowEditSystemDefined`が真でない限り、ソースごと編集不可になる（第3章3.2節）。
   * セルタイプはどのファイルで定義されていても全ファイル分を解決対象として扱う。
   */
  static loadSources(inputSources: readonly CdlSource[], options: LoadOptions = {}): LoadResult {
    // 第3章3.2節: `-S`のディレクトリ配下のCDLは`systemDefined`とし、既定では**ソースごと**編集不可にする。
    // セル単位ではなくソース単位にするのは、編集可能なソースはテンプレートを持ち、保存時にテンプレートの
    // セルをすべて入れ替えるため（編集不可のセルだけが混ざると、そのセルが書き戻しで消える）。
    // 編集不可のソースはテンプレートを持たないので、書き戻しの対象にならない。
    const sources: readonly CdlSource[] = inputSources.map((source) => {
      const systemDefined =
        !source.generated && source.sourcePath !== undefined && isUnderAny(source.sourcePath, options.systemDirs ?? []);
      return systemDefined
        ? { ...source, systemDefined, editable: source.editable && options.allowEditSystemDefined === true }
        : source;
    });
    const diagnostics: Diagnostic[] = [];
    const celltypes = new Map<string, CelltypeRef>();
    const parsedSources: ParsedSource[] = [];
    const signatures = new Set<string>();
    const signatureDeclarations: Array<{ declaration: SignatureDecl; fileName: string }> = [];
    const localTypeDefinitions: TypeDefinition[] = [];
    const pendingCelltypes: Array<{ declaration: CelltypeDecl | CompositeDecl; source: CdlSource }> = [];
    const generates: Array<{ generate: GenerateDecl; fileName: string }> = [];
    let preservedImports: readonly string[] = [];
    let toolInfoTecsgen: ToolInfoTecsgen = emptyToolInfoTecsgen();
    let tecscdeParsed: ToolInfoTecscdeParsed = { cellList: {}, joinList: {}, unknownFields: {} };
    const layoutsBySource = new Map<string, ToolInfoTecscdeParsed>();
    let paper: PaperSpec = PaperSpec.default();
    const regionPaths = new Set<string>(["::"]);
    const editableRegionPaths = new Set<string>(["::"]);
    let sourceTemplate: CdlSourceTemplate | undefined;
    const sourceTemplates = new Map<string, CdlSourceTemplate>();

    for (const source of sources) {
      const { blocks, sourceWithBlanks } = ToolInfoValidator.extractBlocks(source.text);
      const parsed = CdlDocumentBuilder.build(sourceWithBlanks);
      for (const signature of parsed.signatures) {
        if (signature.hasFunctions) signatures.add(signature.name);
        signatureDeclarations.push({ declaration: signature, fileName: source.fileName });
      }
      for (const definition of parsed.typedefs) {
        localTypeDefinitions.push({ ...definition, origin: source.fileName, fallback: false });
      }
      for (const generate of parsed.generates) generates.push({ generate, fileName: source.fileName });
      for (const scope of parsed.scopes) {
        let path = scope.path;
        while (path !== "::") {
          regionPaths.add(path);
          if (source.editable) editableRegionPaths.add(path);
          const separator = path.lastIndexOf("::");
          path = separator === 0 ? "::" : path.slice(0, separator);
        }
      }
      if (source.editable && !source.generated) {
        sourceTemplate = {
          text: source.text,
          cells: parsed.cells.map((cell) => {
            const startIndex = attachedCommentStart(source.text, cell.startIndex);
            return {
              cellName: cell.cellName, regionPath: cell.regionPath, startIndex, endIndex: cell.endIndex,
              leadingText: source.text.slice(startIndex, cell.startIndex),
              joins: cell.joins,
            };
          }),
          composites: parsed.composites.map((composite) => ({ name: composite.name, rawText: composite.structure.rawText })),
          scopes: parsed.scopes.map((scope) => ({ path: scope.path, bodyEndIndex: scope.bodyEndIndex })),
          toolInfoBlocks: blocks.map((block) => ({ toolName: block.toolName, startIndex: block.startIndex, endIndex: block.endIndex })),
        };
        sourceTemplates.set(source.sourcePath ?? source.fileName, sourceTemplate);
      }
      for (const d of parsed.diagnostics) diagnostics.push(withLocation(d, source.fileName));
      // 編集対象ファイルの import / import_C を原文のまま保持する（内部仕様3章）。
      if (source.editable) preservedImports = parsed.imports.map((i) => i.rawText);

      for (const block of source.generated ? [] : blocks) {
        if (block.toolName === "tecsgen") {
          toolInfoTecsgen = ToolInfoValidator.parseTecsgen(block.json);
          const versionDiag = ToolInfoValidator.checkFormatVersion(toolInfoTecsgen);
          if (versionDiag) diagnostics.push(versionDiag);
        } else if (block.toolName === "tecscde") {
          const { parsed: p, diagnostics: d } = ToolInfoValidator.parseTecscde(block.json);
          tecscdeParsed = p;
          layoutsBySource.set(source.sourcePath ?? source.fileName, p);
          diagnostics.push(...d);
          if (p.paper) {
            paper = PaperSpec.create(p.paper.size, p.paper.orientation ?? "LANDSCAPE");
          }
        }
        // 5.1.1: 自分に向けられていないツール名のブロックは読み飛ばす。
      }

      for (const ct of [...parsed.celltypes, ...parsed.composites]) {
        pendingCelltypes.push({ declaration: ct, source });
      }

      parsedSources.push({
        fileName: source.fileName, sourcePath: source.sourcePath, editable: source.editable, generated: source.generated,
        systemDefined: source.systemDefined === true,
        cells: parsed.cells,
      });
    }

    const typeRegistry = new CTypeRegistry(options.cdeclResults, localTypeDefinitions);
    const signatureTypes = new Map<string, ResolvedSignatureType>();
    const resolveUse = (type: TypeUse, fileName: string): TypeResolution => {
      const resolved = type.type ? typeRegistry.resolve(type.type) : { origins: [], fallback: false, reason: "解釈できない C 型" };
      if (resolved.reason) diagnostics.push({
        severity: "warning", code: W_CODES.C_TYPE_UNRESOLVED, message: resolved.reason,
        location: { file: fileName, line: type.line, column: type.column },
      });
      return resolved;
    };
    for (const { declaration, fileName } of signatureDeclarations) {
      const functions = declaration.functions.map((fn) => ({
        name: fn.name,
        returns: resolveUse(fn.returns, fileName),
        parameters: fn.parameters.map((parameter) => resolveUse(parameter, fileName)),
      }));
      signatureTypes.set(declaration.name, {
        id: declaration.name,
        functions,
        valid: functions.every((fn) => Boolean(fn.returns.type) && fn.parameters.every((parameter) => Boolean(parameter.type))),
      });
    }
    const portTypes = new Map<string, ResolvedPortType>();
    const qualifiedCelltypes = new Map<string, CelltypeRef>();
    const portDeclaration = (celltypeName: string, port: PortDecl, fileName: string): { name: string; signature: string; arraySize?: number } => {
      const id = resolveSignatureInScope(port.signature, port.scopePath, signatures);
      const valid = id ? (signatureTypes.get(id)?.valid ?? false) : false;
      portTypes.set(portTypeKey(celltypeName, port.kind, port.name), { signatureId: id, valid });
      if (!id) diagnostics.push({
        severity: "warning", code: W_CODES.PORT_SIGNATURE_UNRESOLVED,
        message: `ポート ${port.name} のシグニチャ ${port.signature} を解決できません。`,
        location: { file: fileName, line: port.line, column: port.column },
        relatedPortName: port.name,
      });
      return { name: port.name, signature: id ? `::${id}` : port.signature, arraySize: port.arraySize };
    };
    // 名前つき`require`（`require 名前 = 要求先.受け口;`）の呼び口は、要求先の受け口のシグニチャを持つ
    // （第4B章4B.5節）。要求先は、セルタイプ名、またはセル名（そのセルのセルタイプ）で指定される。
    const celltypeDeclarations = new Map<string, CelltypeDecl>();
    for (const { declaration } of pendingCelltypes) {
      if (!isOrdinaryCelltype(declaration)) continue;
      celltypeDeclarations.set(declaration.name, declaration);
      celltypeDeclarations.set(declaration.qualifiedName, declaration);
    }
    const celltypeNameOfCell = new Map<string, string>();
    for (const parsedSource of parsedSources) {
      for (const cellDecl of parsedSource.cells) {
        if (!celltypeNameOfCell.has(cellDecl.cellName)) celltypeNameOfCell.set(cellDecl.cellName, cellDecl.celltypeName);
      }
    }
    const withRequireSignature = (port: PortDecl): PortDecl => {
      if (!port.requireTarget) return port;
      const { owner, entry } = port.requireTarget;
      const declaration = celltypeDeclarations.get(owner) ?? celltypeDeclarations.get(celltypeNameOfCell.get(owner) ?? "");
      const target = declaration?.ports.find((candidate) => candidate.kind === "entry" && candidate.name === entry);
      // 見つからないときは要求先の表記をそのままシグニチャにし、解決できない警告で知らせる。
      return target ? { ...port, signature: target.signature, scopePath: target.scopePath } : { ...port, signature: `${owner}.${entry}` };
    };
    for (const { declaration: ct, source } of pendingCelltypes) {
      const composite = isOrdinaryCelltype(ct) ? undefined : ct.structure;
      const typeName = source.generated && isOrdinaryCelltype(ct) ? ct.qualifiedName : ct.name;
      const cportDecls = ct.ports.filter((p) => p.kind === "call" && !p.isRequire)
        .map((p) => portDeclaration(typeName, withRequireSignature(p), source.fileName));
      const eportDecls = ct.ports.filter((p) => p.kind === "entry")
        .map((p) => portDeclaration(typeName, p, source.fileName));
      const hiddenRequirePortCount = ct.ports.filter((p) => p.kind === "call" && p.isRequire).length;
      const celltype = CelltypeRef.create({
        name: typeName,
        cportTemplates: assignDefaultPortLayout(cportDecls, "LEFT", 15),
        eportTemplates: assignDefaultPortLayout(eportDecls, "RIGHT", 15),
        attributeNames: ct.attributes,
        attributeOptions: ct.attributeOptions,
        hiddenRequirePortCount,
        locale: source.fileName,
        composite,
        hasUnsupportedSyntax: isOrdinaryCelltype(ct) ? false : ct.hasUnsupportedSyntax,
      });
      celltypes.set(typeName, celltype);
      qualifiedCelltypes.set(isOrdinaryCelltype(ct) ? ct.qualifiedName : ct.name, celltype);
    }

    registerMrubyBridgeCelltypes(celltypes, signatures, generates);
    const celltypeLookup = new Map([...celltypes, ...qualifiedCelltypes]);

    const { width: paperW, height: paperH } = paper.contentSize();

    // --- セル（1周目: 本体とポート。全ファイル分をまとめて処理する） ---
    const cells = new Map<CellId, Cell>();
    const selectedCells = new Map<string, { declaration: CellDecl; source: ParsedSource }>();
    for (const source of parsedSources) {
      for (const declaration of source.cells) {
        const previous = selectedCells.get(declaration.cellName);
        if (!previous) {
          selectedCells.set(declaration.cellName, { declaration, source });
        } else if (source.generated && previous.source.generated) {
          // tecsgen may emit a prototype before the populated cell definition.
          const details = (cell: CellDecl): number => cell.joins.length + cell.attrs.length;
          if (details(declaration) > details(previous.declaration)) {
            selectedCells.set(declaration.cellName, { declaration, source });
          }
        } else if (!source.generated) {
          diagnostics.push(duplicateCell(declaration.cellName, {
            file: source.fileName, line: declaration.line, column: declaration.column,
          }));
        }
      }
    }
    const selectedSources: ParsedSource[] = [...selectedCells.values()].map(({ declaration, source }) => ({
      ...source, cells: [declaration],
    }));
    let autoIndex = 0;

    for (const src of selectedSources) {
      for (const decl of src.cells) {
        const id = asCellId(decl.cellName);
        const celltype = resolveCelltypeInScope(celltypeLookup, decl.celltypeName, decl.regionPath);
        const layout = (layoutsBySource.get(src.sourcePath ?? src.fileName) ?? tecscdeParsed).cellList[decl.cellName];
        const savedRegion = layout?.region;
        const regionPath = decl.regionPath !== "::" ? decl.regionPath :
          savedRegion && (src.editable ? editableRegionPaths : regionPaths).has(savedRegion) ? savedRegion : "::";
        if (savedRegion && savedRegion !== regionPath) diagnostics.push({
          severity: "warning", code: W_CODES.REGION_MISMATCH,
          message: `セル ${decl.cellName} のリージョン情報 ${savedRegion} とCDLの所属 ${regionPath} が一致しません。`,
          location: { file: src.fileName, line: decl.line, column: decl.column },
        });

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
            regionId: asRegionId(regionPath),
              editable: src.editable,
              systemDefined: src.systemDefined,
              cports: [],
              eports: [],
              attrs,
              celltypeUnresolved: true,
              locale: src.sourcePath ?? src.fileName,
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
            celltypeName: celltype.name,
            x,
            y,
            width,
            height,
          regionId: asRegionId(regionPath),
            editable: src.editable,
            systemDefined: src.systemDefined,
            cports,
            eports,
            attrs,
            celltypeUnresolved: false,
            locale: src.sourcePath ?? src.fileName,
          }),
        );
      }
    }

    // --- 結合（2周目: 全セルが揃ってから解決） ---
    const joins = new Map<JoinId, Join>();
    for (const src of selectedSources) {
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

          const savedBars = (layoutsBySource.get(src.sourcePath ?? src.fileName) ?? tecscdeParsed).joinList[jid as unknown as string]?.bars;
          const bars: readonly Bar[] = savedBars
            ? savedBars.map((b) => ({ direction: b.dir, fixed: b.fixed, from: b.from, to: b.to }))
            : autoRouteBars(
                portPosition(sourceCell, cport),
                cport.edgeSide,
                portPosition(targetCell, eport),
                eport.edgeSide,
                [...cells.values()], // 外部仕様7.3.2: 保存済みの経路が無い結合は、他のセルを避ける
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

    for (const [sourceKey, template] of sourceTemplates) {
      const updated = {
        ...template,
        cells: template.cells.map((cell) => ({
          ...cell,
          joins: cell.joins?.filter((join) => !joins.has(asJoinId(
            `${cell.cellName}.${join.cport}${join.cportIndex !== undefined ? `[${join.cportIndex}]` : ""}`,
          ))),
        })),
      };
      sourceTemplates.set(sourceKey, updated);
      if (sourceTemplate === template) sourceTemplate = updated;
    }

    const editingSource = sources.slice().reverse().find((source) => source.editable);
    const referenceFiles = sources.filter((source) => source !== editingSource && !source.generated).map((source) => source.fileName);

    const document = TecscdeDocument.build({
      cells,
      joins,
      celltypes,
      regions: buildRegionTree(regionPaths, cells),
      toolInfoTecsgen,
      paper,
      referenceFiles,
      editingFileName: editingSource?.sourcePath ?? editingSource?.fileName,
      unknownToolInfoTecscde: tecscdeParsed.unknownFields,
      preservedImports,
      sourceTemplate,
      sourceTemplates,
    });

    return { document, diagnostics, portTypeIndex: { signatures: signatureTypes, ports: portTypes } };
  }

  /** 単一ファイル読み込みの簡便ラッパ（テスト・新規作成後の1ファイル読込用）。 */
  static loadSingle(text: string, fileName: string, editable = true): LoadResult {
    return CdlDocumentLoader.loadSources([{ text, fileName, editable }]);
  }
}

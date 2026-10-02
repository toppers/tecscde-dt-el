// TECSCDE-TS内部仕様 2.2 — TecscdeDocument を .cde（CDL本体）テキストへ書き戻す（CdlSerializer）。
// 既存ファイルではCDLのスコープ・未対応構文を保持してセル定義とtool_infoを更新する。
// 新規ドキュメントは既定の3ブロック形式で出力する。

import type { Cell } from "../model/cell";
import type { EdgeSide } from "../model/port";
import { CDE_FORMAT_VERSION, TECSCDE_TS_VERSION } from "../model/tool-info-types";
import type { TecscdeDocument } from "../model/document";
import { ToolInfoValidator, type CellLayout, type JoinLayout } from "./tool-info";
import { CdlDocumentBuilder } from "./cst";

function formatToolInfoBlock(toolName: string, json: string): string {
  return `__tool_info__("${toolName}") ${json}`;
}

function cellJoinLines(doc: TecscdeDocument, cell: Cell): string[] {
  const lines: string[] = [];
  for (const cport of cell.cports) {
    if (cport.joinId === null) continue;
    const join = doc.getJoin(cport.joinId);
    if (!join) continue;
    const targetCell = doc.getCell(join.eportCellId);
    if (!targetCell) continue;
    const lhs = cport.subscript !== null ? `${cport.name}[${cport.subscript}]` : cport.name;
    lines.push(`  ${lhs} = ${targetCell.name}.${join.eportName};`);
  }
  return lines;
}

function cellAttrLines(cell: Cell): string[] {
  return Object.entries(cell.attrs).map(([name, expr]) => `  ${name} = ${expr};`);
}

function serializeCellBlock(doc: TecscdeDocument, cell: Cell): string {
  const body = [...cellJoinLines(doc, cell), ...cellAttrLines(cell)];
  // 末尾の `;` はCDL文法上必須（tecsgen の bnf.y.rb が cell 定義の終端として要求する）。
  return [`cell ${cell.celltypeName} ${cell.name} {`, ...body, `};`].join("\n");
}

interface TextEdit { readonly start: number; readonly end: number; readonly text: string }

function serializeFromTemplate(
  doc: TecscdeDocument,
  cells: readonly Cell[],
  tecsgenBlock: string,
  tecscdeBlock: string,
): string {
  const template = doc.sourceTemplate!;
  for (const cell of cells) {
    const region = doc.regions.findById(cell.regionId);
    if (!region || !region.cellIds.includes(cell.id)) {
      throw new Error(`リージョン所属が不整合です: ${cell.name}`);
    }
  }
  if (new Set(template.cells.map((cell) => cell.cellName)).size !== template.cells.length) {
    throw new Error("同名セルが複数あるため、CDLを安全に保存できません。");
  }
  const edits: TextEdit[] = template.cells.map((cell) => ({
    start: cell.startIndex, end: cell.endIndex, text: "",
  }));
  const insertions = new Map<string, string[]>();
  const originalCells = new Map(template.cells.map((cell) => [cell.cellName, cell]));
  const scopeEnd = new Map<string, number>(template.scopes.map((scope) => [scope.path, scope.bodyEndIndex]));
  for (const cell of cells) {
    const path = doc.regions.findById(cell.regionId)?.namespacePath;
    if (!path || (path !== "::" && !scopeEnd.has(path))) {
      throw new Error(`保存先リージョンが編集ファイルにありません: ${cell.name}`);
    }
    const blocks = insertions.get(path) ?? [];
    blocks.push((originalCells.get(cell.id)?.leadingText ?? "") + serializeCellBlock(doc, cell));
    insertions.set(path, blocks);
  }
  for (const [path, blocks] of insertions) {
    const start = path === "::" ? template.text.length : scopeEnd.get(path)!;
    edits.push({ start, end: start, text: `\n${blocks.join("\n\n")}\n` });
  }
  let hasTecsgen = false;
  let hasTecscde = false;
  for (const block of template.toolInfoBlocks) {
    if (block.toolName !== "tecsgen" && block.toolName !== "tecscde") continue;
    const replacement = block.toolName === "tecsgen" ? tecsgenBlock : tecscdeBlock;
    const alreadyWritten = block.toolName === "tecsgen" ? hasTecsgen : hasTecscde;
    edits.push({ start: block.startIndex, end: block.endIndex, text: alreadyWritten ? "" : replacement });
    if (block.toolName === "tecsgen") hasTecsgen = true;
    else hasTecscde = true;
  }
  if (!hasTecsgen) edits.push({ start: 0, end: 0, text: `${tecsgenBlock}\n\n` });
  if (!hasTecscde) edits.push({ start: template.text.length, end: template.text.length, text: `\n${tecscdeBlock}\n` });
  let result = template.text;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  const sourceWithBlanks = ToolInfoValidator.extractBlocks(result).sourceWithBlanks;
  const parsed = CdlDocumentBuilder.build(sourceWithBlanks);
  const expected = new Map(cells.map((cell) => [cell.name, doc.regions.findById(cell.regionId)?.namespacePath]));
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
      parsed.cells.length !== cells.length ||
      parsed.cells.some((cell) => expected.get(cell.cellName) !== cell.regionPath)) {
    throw new Error("保存後のCDLでセルの所属を復元できません。");
  }
  return result.endsWith("\n") ? result : `${result}\n`;
}

export class CdlSerializer {
  /**
   * ドキュメントを保存可能なテキストへ直列化する。
   * 決定性のため、セルは名前順にソートして出力する（同じドキュメント内容からは常に同じ出力が得られる。
   * ただしtecsgenブロックのsaved_atは保存時刻を反映するため、この値自体は毎回変わる）。
   */
  static serialize(doc: TecscdeDocument, now: Date = new Date()): string {
    const editableCells = doc
      .cellValues()
      .filter((c) => c.editable)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const tecsgenBlock = formatToolInfoBlock(
      "tecsgen",
      ToolInfoValidator.serializeTecsgen({
        ...doc.toolInfoTecsgen,
        tecscdeVersion: TECSCDE_TS_VERSION,
        cdeFormatVersion: CDE_FORMAT_VERSION,
        savedAt: now.toISOString(),
        directImport: doc.referenceFiles,
      }),
    );

    const cellBlocks = editableCells.map((c) => serializeCellBlock(doc, c)).join("\n\n");

    const cellList: Record<string, CellLayout> = {};
    for (const cell of editableCells) {
      const ports: Record<string, { edge: EdgeSide; offset: number }> = {};
      for (const p of [...cell.cports, ...cell.eports]) {
        ports[p.name] = { edge: p.edgeSide, offset: p.offset };
      }
      cellList[cell.name] = {
        location: [cell.x, cell.y, cell.width, cell.height],
        region: cell.regionId,
        ports,
      };
    }

    const joinList: Record<string, JoinLayout> = {};
    for (const join of doc.joinValues()) {
      const sourceCell = doc.getCell(join.cellId);
      if (!sourceCell?.editable) continue; // 5.4.1: 編集可能セル由来の結合のみ書き出す
      const targetCell = doc.getCell(join.eportCellId);
      joinList[join.id] = {
        cell: sourceCell.name,
        cport: join.cportName,
        targetCell: targetCell?.name ?? "",
        eport: join.eportName,
        bars: join.bars.map((b) => ({ dir: b.direction, fixed: b.fixed, from: b.from, to: b.to })),
      };
    }

    const tecscdeBlock = formatToolInfoBlock(
      "tecscde",
      ToolInfoValidator.serializeTecscde(doc.paper, cellList, joinList, doc.unknownToolInfoTecscde),
    );

    if (doc.sourceTemplate) return serializeFromTemplate(doc, editableCells, tecsgenBlock, tecscdeBlock);

    // 内部仕様3章: モデルに反映しない構文（import / import_C）は入力時のテキストの
    // まま書き戻す。tecsgen は import をファイル先頭付近で解決するため、
    // cell 定義より前・tecsgenブロックの直後に置く。
    const importBlock = (doc.preservedImports ?? []).join("\n");

    return (
      [tecsgenBlock, importBlock, cellBlocks, tecscdeBlock]
        .filter((s) => s.length > 0)
        .join("\n\n") + "\n"
    );
  }
}

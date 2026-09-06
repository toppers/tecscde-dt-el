// TECSCDE-TS内部仕様 2.2 — TecscdeDocument を .cde（CDL本体）テキストへ書き戻す（CdlSerializer）。
// 外部仕様5.1.1が確定した3ブロックの順序をそのまま踏襲する:
//   ① __tool_info__("tecsgen")  — 解釈せず保持した値をそのまま書き戻す（5.1.2）
//   ② cell定義（editable なセルのみ、5.4.1）
//   ③ __tool_info__("tecscde") — 用紙・配置・結合経路。未知キーも保持する（5.5.2）

import type { Cell } from "../model/cell";
import type { EdgeSide } from "../model/port";
import { CDE_FORMAT_VERSION, TECSCDE_TS_VERSION } from "../model/tool-info-types";
import type { TecscdeDocument } from "../model/document";
import { ToolInfoValidator, type CellLayout, type JoinLayout } from "./tool-info";

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
  return [`cell ${cell.celltypeName} ${cell.name} {`, ...body, `}`].join("\n");
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

    return [tecsgenBlock, cellBlocks, tecscdeBlock].filter((s) => s.length > 0).join("\n\n") + "\n";
  }
}

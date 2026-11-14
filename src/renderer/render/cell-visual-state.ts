// [[TECSCDE-DT-EL内部仕様]] 第5B章5B.1節 — 色に依存しないセル状態導出 `CellVisualState`。
//
// 編集不可・不完全・未結合を独立して導出し、描画・凡例・プロパティで同じスナップショットを共用する。

import type { TecscdeDocument } from "../model/document";
import type { Cell } from "../model/cell";
import type { Diagnostic } from "../diagnostics/types";

export type PortId = string;

export interface CellVisualState {
  readonly readOnly: boolean;
  readonly incompleteReasons: readonly string[];
  readonly unconnectedCallPortIds: readonly PortId[] | null;
}

/**
 * 現在のドキュメント、対象セル、および構造診断（任意）から CellVisualState を導出する。
 */
export function deriveCellVisualState(
  _doc: TecscdeDocument,
  cell: Cell,
  structuralIssues?: readonly Diagnostic[],
): CellVisualState {
  const readOnly = !cell.editable;

  const incompleteReasons: string[] = [];
  if (cell.celltypeUnresolved) {
    incompleteReasons.push("セルタイプ未解決");
  }
  if (structuralIssues) {
    for (const d of structuralIssues) {
      if (d.relatedCellId === cell.id && d.severity === "error") {
        if (!incompleteReasons.includes(d.message)) {
          incompleteReasons.push(d.message);
        }
      }
    }
  }

  let unconnectedCallPortIds: PortId[] | null = null;
  if (!cell.celltypeUnresolved) {
    unconnectedCallPortIds = [];
    for (const port of cell.cports) {
      if (port.joinId === null) {
        const id = port.subscript !== null ? `${port.name}[${port.subscript}]` : port.name;
        unconnectedCallPortIds.push(id);
      }
    }
  }

  return {
    readOnly,
    incompleteReasons,
    unconnectedCallPortIds,
  };
}

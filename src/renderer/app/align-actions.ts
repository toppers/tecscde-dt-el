// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — 整列操作のアプリ層（外部仕様7.3.2）。
// 複数のセルを選択しているとき、「上端をそろえる」「左端をそろえる」を提供する。基準は
// 選択順で最初に選択したセルの位置（`SelectionState.cellIds` は挿入順を保つ `Set`）。
// 実際の移動は `AlignTopCommand` / `AlignLeftCommand`（編集可能なセルだけを動かし、結合を再配線する）。

import type { AppStore } from "./store";
import { AlignLeftCommand, AlignTopCommand } from "../commands";
import type { CellId } from "../model/ids";

export type AlignAxis = "top" | "left";

interface AlignTargets {
  readonly referenceId: CellId;
  readonly cellIds: readonly CellId[];
}

/**
 * 整列に使う基準セルと対象セル。選択が2セル未満、基準が文書に無い、または実際に動くセルが
 * 1つも無い（すでにそろっている、あるいは読み取り専用）場合は `undefined`。
 */
function alignTargets(store: AppStore, axis: AlignAxis): AlignTargets | undefined {
  const cellIds = [...store.selection.cellIds];
  const [referenceId, ...others] = cellIds;
  if (referenceId === undefined || others.length === 0) return undefined;
  const doc = store.getDocument();
  const ref = doc.getCell(referenceId);
  if (!ref) return undefined;
  const movable = others.some((id) => {
    const cell = doc.getCell(id);
    if (!cell || !cell.editable) return false;
    return axis === "top" ? cell.y !== ref.y : cell.x !== ref.x;
  });
  return movable ? { referenceId, cellIds } : undefined;
}

/** 現在の選択で整列操作が意味を持つか（ツールバーのボタンの有効・無効に使う）。 */
export function canAlign(store: AppStore, axis: AlignAxis): boolean {
  return alignTargets(store, axis) !== undefined;
}

/** 選択中のセルを整列する。動くセルが無ければ何もしない（履歴にも積まない）。 */
export function alignSelection(store: AppStore, axis: AlignAxis): void {
  const targets = alignTargets(store, axis);
  if (!targets) return;
  const { cellIds, referenceId } = targets;
  store.dispatch(
    axis === "top" ? new AlignTopCommand(cellIds, referenceId) : new AlignLeftCommand(cellIds, referenceId),
  );
}

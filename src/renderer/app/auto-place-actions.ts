// 外部仕様7.3.x（2026-11-03）— 「自動配置」（選択したセル）と「全体を自動配置」（編集できるすべてのセル）。
// 実際の移動は `AutoPlaceCellsCommand`（編集できるセルだけを動かし、結合を再配線する。1回の「元に戻す」で戻る）。

import type { AppStore } from "./store";
import { AutoPlaceCellsCommand, planAutoPlacement } from "../commands/layout-commands";
import { autoLayoutOverflow } from "../cdl/messages";
import type { CellId } from "../model/ids";

export type AutoPlaceScope = "selection" | "all";

/** 対象のセルのID。選択範囲なら選択中のセル、全体なら全セル（動かすのは、そのうち編集できるセルだけ）。 */
function scopeCellIds(store: AppStore, scope: AutoPlaceScope): CellId[] {
  return scope === "all" ? store.getDocument().cellValues().map((cell) => cell.id) : [...store.selection.cellIds];
}

/** 編集できる対象のセルが1つ以上あるか（ツールバーのボタンの有効・無効に使う）。 */
export function canAutoPlace(store: AppStore, scope: AutoPlaceScope): boolean {
  return planAutoPlacement(store.getDocument(), scopeCellIds(store, scope)).targetIds.length > 0;
}

/** 自動配置し直す。動かすセルが無ければ何もしない。収まらなかったセルの数は、診断の一覧で知らせる。 */
export function autoPlace(store: AppStore, scope: AutoPlaceScope): void {
  const cellIds = scopeCellIds(store, scope);
  const plan = planAutoPlacement(store.getDocument(), cellIds);
  if (plan.targetIds.length === 0) return;
  store.dispatch(new AutoPlaceCellsCommand(cellIds));
  store.setAutoLayoutDiagnostics(plan.overflow > 0 ? [autoLayoutOverflow(plan.overflow)] : []);
}

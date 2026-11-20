// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.3節 — 結合強調 `resolveHighlightedJoinIds`。
//
// 選択されたポート（呼び口／受け口）から直接の結合ID集合を導出する。
// 複合セル内部や間接結合はたどらず、推移閉包は取らない。

import type { TecscdeDocument } from "../model/document";
import type { JoinId } from "../model/ids";
import { resolveSelectedPort, type SelectedPort } from "./view";

/**
 * 現在のドキュメントと選択されたポート群から、直接結合している結合IDの集合を純粋に導出する。
 */
export function resolveHighlightedJoinIds(
  doc: TecscdeDocument,
  selectedPorts: readonly SelectedPort[],
): ReadonlySet<JoinId> {
  if (selectedPorts.length === 0) return new Set();

  const highlighted = new Set<JoinId>();

  for (const selected of selectedPorts) {
    const resolved = resolveSelectedPort(doc, selected);
    if (!resolved) continue;

    if ("joinId" in resolved.port) {
      if (resolved.port.joinId !== null) {
        highlighted.add(resolved.port.joinId);
      }
    } else {
      for (const jid of resolved.port.joinIds) {
        highlighted.add(jid);
      }
    }
  }

  return highlighted;
}

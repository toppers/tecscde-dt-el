// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.3節 — 結合強調 `resolveHighlightedJoinIds`。
//
// 選択されたポート（呼び口／受け口）から直接の結合ID集合を導出する。
// 複合セル内部や間接結合はたどらず、推移閉包は取らない。

import type { TecscdeDocument } from "../model/document";
import type { JoinId } from "../model/ids";
import type { SelectedPort } from "./view";

/**
 * 現在のドキュメントと選択されたポート群から、直接結合している結合IDの集合を純粋に導出する。
 */
export function resolveHighlightedJoinIds(
  doc: TecscdeDocument,
  selectedPorts: readonly SelectedPort[],
): ReadonlySet<JoinId> {
  if (selectedPorts.length === 0) return new Set();

  const highlighted = new Set<JoinId>();

  for (const port of selectedPorts) {
    const cell = doc.getCell(port.cellId);
    if (!cell) continue;

    if (port.kind === "cport") {
      const cport = cell.findCPort(port.portName, port.subscript);
      if (cport && cport.joinId !== null) {
        highlighted.add(cport.joinId);
      }
    } else {
      const eport = cell.findEPort(port.portName, port.subscript);
      if (eport) {
        for (const jid of eport.joinIds) {
          highlighted.add(jid);
        }
      }
    }
  }

  return highlighted;
}

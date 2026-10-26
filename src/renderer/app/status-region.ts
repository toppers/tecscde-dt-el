// 外部仕様4.9.2 — セルを選択したとき、所属リージョンをステータス表示に示す。
// 色分け（7.5.2）だけに頼らずにリージョンが分かるようにするための表示（色のみに依存させない）。

import { ROOT_REGION_ID } from "../model/ids";
import type { TecscdeDocument } from "../model/document";
import type { SelectionState } from "../render/view";

/**
 * 選択中のセルの所属リージョンを表す文字列。セルが選ばれていなければ空。
 * 1つのリージョンならそのパス（根は「ルート」）、複数にまたがるなら「複数（N）」。
 * 結合の選択や、文書に無いセルIDは数えない。
 */
export function regionStatusText(doc: TecscdeDocument, selection: SelectionState): string {
  const regions = new Set<string>();
  for (const id of selection.cellIds) {
    const cell = doc.getCell(id);
    if (cell) regions.add(cell.regionId);
  }
  if (regions.size === 0) return "";
  if (regions.size > 1) return `リージョン: 複数（${regions.size}）`;
  const [only] = regions;
  return `リージョン: ${only === ROOT_REGION_ID ? "ルート" : only}`;
}

// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.1節 — `isActiveCell` 判定。
//
// 判定はセルの型の `active` 指定のみを参照し、複合型の内部展開による推定は行わない。
// 純粋関数として共用される。

import type { TecscdeDocument } from "./document";
import type { Cell } from "./cell";

export function isActiveCell(doc: TecscdeDocument, cell: Cell): boolean {
  if (cell.celltypeUnresolved) return false;
  const celltype = doc.getCelltype(cell.celltypeName);
  return celltype?.active ?? false;
}

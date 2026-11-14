import type { TecscdeDocument } from "../model/document";
import type { Cell } from "../model/cell";
import type { CanvasView } from "./view";

/** Active is a property of the declared type, independent of editing/selection. */
export function isActiveCell(doc: TecscdeDocument, cell: Cell): boolean {
  return doc.getCelltype(cell.celltypeName)?.active === true;
}

/** Shared by rendering, hit testing, selection overlays and export snapshots. */
export function isCellVisible(doc: TecscdeDocument, cell: Cell, view: CanvasView): boolean {
  return !view.hiddenRegionIds.has(cell.regionId) && (view.activeOnly !== true || isActiveCell(doc, cell));
}

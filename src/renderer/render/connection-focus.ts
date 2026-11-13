import type { TecscdeDocument } from "../model/document";
import type { JoinId } from "../model/ids";
import type { SelectedPort } from "./view";

export function resolveHighlightedJoinIds(doc: TecscdeDocument, selected: readonly SelectedPort[]): ReadonlySet<JoinId> {
  const ids = new Set<JoinId>();
  for (const selection of selected) {
    const cell = doc.getCell(selection.cellId);
    const ports = selection.kind === "cport" ? cell?.cports : cell?.eports;
    const port = ports?.find((value) => value.name === selection.name && value.subscript === selection.subscript);
    if (!port) continue;
    if ("joinId" in port) { if (port.joinId) ids.add(port.joinId); }
    else for (const id of port.joinIds) ids.add(id);
  }
  return ids;
}

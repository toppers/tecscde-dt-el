import type { TecscdeDocument } from "../model/document";

/** 7J.1: compare persisted data, excluding generated timestamps and presentation state. */
export function sourceSaveState(document: TecscdeDocument, key: string | null): string {
  const primary = key === document.editingFileName || (key === null && !document.editingFileName);
  const cells = document.cellValues().filter((cell) => cell.editable &&
    (cell.locale === key || (primary && !document.editingFileName && !cell.locale)))
    .map((cell) => ({
      name: cell.name, celltypeName: cell.celltypeName, regionId: cell.regionId,
      x: cell.x, y: cell.y, width: cell.width, height: cell.height, attrs: cell.attrs,
      ports: [...cell.cports, ...cell.eports].map((port) => ({
        name: port.name, edgeSide: port.edgeSide, offset: port.offset,
        subscript: port.subscript, arraySize: port.arraySize,
      })),
    })).sort((a, b) => a.name.localeCompare(b.name));
  const owners = new Set(document.cellValues().filter((cell) => cell.editable &&
    (cell.locale === key || (primary && !document.editingFileName && !cell.locale))).map((cell) => cell.id));
  const joins = document.joinValues().filter((join) => owners.has(join.cellId)).map((join) => ({
    cell: document.getCell(join.cellId)?.name, cport: join.cportName,
    subscript: document.getCell(join.cellId)?.cports.find((port) => port.joinId === join.id)?.subscript,
    target: document.getCell(join.eportCellId)?.name, eport: join.eportName,
    bars: join.bars,
  })).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const { savedAt: _savedAt, tecscdeVersion: _version, cdeFormatVersion: _format,
    directImport: _derivedSources, ...toolInfo } = document.toolInfoTecsgen;
  return canonical({ cells, joins,
    ...(primary ? { paper: document.paper, toolInfo, imports: document.preservedImports,
      unknown: document.unknownToolInfoTecscde } : {}),
  });
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

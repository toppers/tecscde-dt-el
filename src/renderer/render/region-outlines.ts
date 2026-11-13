import type { TecscdeDocument } from "../model/document";
import type { CellId, RegionId } from "../model/ids";
import type { Region, RegionTree } from "../model/region";
import type { Point } from "../model/geometry";
import { pxPerMm, type CanvasView } from "./view";

export interface OutlineRectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface OutlineSegment { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
export interface RegionOutline {
  readonly regionId: RegionId;
  readonly name: string;
  readonly depth: number;
  readonly margin: number;
  readonly rectangles: readonly OutlineRectangle[];
  readonly segments: readonly OutlineSegment[];
  readonly labelPosition: Point;
}

/** Coordinate-compressed union: input rectangles are retained, only boundary edges are merged. */
export function rectangleUnionBoundary(rectangles: readonly OutlineRectangle[]): readonly OutlineSegment[] {
  const valid = rectangles.filter((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0);
  if (!valid.length) return [];
  const xs = [...new Set(valid.flatMap((box) => [box.x, box.x + box.width]))].sort((a, b) => a - b);
  const ys = [...new Set(valid.flatMap((box) => [box.y, box.y + box.height]))].sort((a, b) => a - b);
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  const width = xs.length;
  const grid = new Int32Array(width * ys.length);
  const at = (x: number, y: number): number => y * width + x;
  for (const box of valid) {
    const left = xIndex.get(box.x)!, right = xIndex.get(box.x + box.width)!;
    const top = yIndex.get(box.y)!, bottom = yIndex.get(box.y + box.height)!;
    grid[at(left, top)]!++;
    grid[at(right, top)]!--;
    grid[at(left, bottom)]!--;
    grid[at(right, bottom)]!++;
  }
  for (let y = 0; y < ys.length; y++) for (let x = 0; x < xs.length; x++) {
    grid[at(x, y)] = grid[at(x, y)]! + (x > 0 ? grid[at(x - 1, y)]! : 0) +
      (y > 0 ? grid[at(x, y - 1)]! : 0) - (x > 0 && y > 0 ? grid[at(x - 1, y - 1)]! : 0);
  }
  const filled = (x: number, y: number): boolean => x >= 0 && x < xs.length - 1 && y >= 0 && y < ys.length - 1 && grid[at(x, y)]! > 0;
  const horizontal = new Map<number, Array<[number, number]>>();
  const vertical = new Map<number, Array<[number, number]>>();
  const edge = (map: Map<number, Array<[number, number]>>, fixed: number, start: number, end: number): void => {
    const intervals = map.get(fixed) ?? []; intervals.push([start, end]); map.set(fixed, intervals);
  };
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) edge(horizontal, ys[y]!, xs[x]!, xs[x + 1]!);
    if (!filled(x, y + 1)) edge(horizontal, ys[y + 1]!, xs[x]!, xs[x + 1]!);
    if (!filled(x - 1, y)) edge(vertical, xs[x]!, ys[y]!, ys[y + 1]!);
    if (!filled(x + 1, y)) edge(vertical, xs[x + 1]!, ys[y]!, ys[y + 1]!);
  }
  const result: OutlineSegment[] = [];
  const merge = (map: Map<number, Array<[number, number]>>, horizontalAxis: boolean): void => {
    for (const [fixed, intervals] of [...map].sort(([a], [b]) => a - b)) {
      intervals.sort(([a], [b]) => a - b);
      let first = intervals[0]![0], last = intervals[0]![1];
      const emit = (): void => { result.push(horizontalAxis ? { x1: first, y1: fixed, x2: last, y2: fixed } : { x1: fixed, y1: first, x2: fixed, y2: last }); };
      for (const [start, end] of intervals.slice(1)) {
        if (start <= last) last = Math.max(last, end);
        else { emit(); first = start; last = end; }
      }
      emit();
    }
  };
  merge(horizontal, true); merge(vertical, false);
  return result;
}

/** 06C.5: root excluded; ancestors contain visible descendant cell bodies. */
export function computeRegionOutlines(
  doc: TecscdeDocument,
  visibleCellIds: ReadonlySet<CellId>,
  regionTree: RegionTree = doc.regions,
): readonly RegionOutline[] {
  const byRegion = new Map<RegionId, OutlineRectangle[]>();
  for (const cell of doc.cellValues()) {
    if (!visibleCellIds.has(cell.id)) continue;
    const boxes = byRegion.get(cell.regionId) ?? [];
    boxes.push({ x: cell.x, y: cell.y, width: cell.width, height: cell.height });
    byRegion.set(cell.regionId, boxes);
  }
  const outlines: RegionOutline[] = [];
  const visit = (region: Region, depth: number): { height: number; boxes: readonly OutlineRectangle[] } => {
    const children = region.children.map((child) => visit(child, depth + 1));
    const height = children.length ? 1 + Math.max(...children.map((child) => child.height)) : 0;
    const boxes = [...(byRegion.get(region.id) ?? []), ...children.flatMap((child) => child.boxes)];
    if (depth > 0 && boxes.length) {
      const margin = 1 + height;
      const rectangles = boxes.map((box) => ({ x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }));
      const segments = rectangleUnionBoundary(rectangles);
      const labelPosition = segments.flatMap((line) => [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }])
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (labelPosition) outlines.push({ regionId: region.id, name: region.namespacePath, depth, margin, rectangles, segments, labelPosition });
    }
    return { height, boxes };
  };
  visit(regionTree.root, 0);
  return outlines.sort((a, b) => a.depth - b.depth || (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
}

export function renderRegionOutlines(layer: SVGGElement, outlines: readonly RegionOutline[], view: CanvasView, colors: ReadonlyMap<RegionId, string>): void {
  layer.replaceChildren();
  layer.setAttribute("pointer-events", "none");
  const doc = layer.ownerDocument, ns = "http://www.w3.org/2000/svg", scale = pxPerMm(view);
  for (const outline of outlines) {
    const group = doc.createElementNS(ns, "g"); group.dataset["regionId"] = outline.regionId;
    group.setAttribute("class", "region-outline");
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", outline.segments.map((line) => `M${line.x1 * scale},${line.y1 * scale}L${line.x2 * scale},${line.y2 * scale}`).join(" "));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", colors.get(outline.regionId) ?? "#666666");
    path.setAttribute("stroke-width", String(0.35 * scale));
    const text = doc.createElementNS(ns, "text"); text.textContent = outline.name;
    text.setAttribute("class", "region-outline-name");
    text.setAttribute("x", String(outline.labelPosition.x * scale)); text.setAttribute("y", String(outline.labelPosition.y * scale));
    text.setAttribute("font-size", String(2.5 * scale)); text.setAttribute("fill", colors.get(outline.regionId) ?? "#666666");
    group.append(path, text); layer.append(group);
  }
}

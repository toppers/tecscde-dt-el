// DT-EL内部仕様7F: 画面とは独立した SVG を組み立てる。
import type { TecscdeDocument } from "../model/document";
import type { Point } from "../model/geometry";
import { SelectionState, MM_TO_PX, type CanvasView } from "../render/view";
import { SvgRenderer } from "../render/svg-renderer";
import { joinPolyline, joinStub, stubTick, STUB_TICK_MM } from "../render/svg-path";
import { SVG_STYLES } from "../render/svg-styles";

export type SvgExportRange = "paper" | "content";
export interface ExportedSvg {
  readonly svg: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PAPER_MARGIN_MM = 10;
const CONTENT_MARGIN_MM = 5;

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function diagramBounds(doc: TecscdeDocument, hidden: ReadonlySet<string>): Bounds | undefined {
  let bounds: Bounds | undefined;
  const add = (point: Point): void => {
    if (!bounds) bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
    else {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  };
  for (const cell of doc.cellValues()) {
    if (hidden.has(cell.regionId)) continue;
    add({ x: cell.x, y: cell.y });
    add({ x: cell.x + cell.width, y: cell.y + cell.height });
  }
  for (const join of doc.joinValues()) {
    const source = doc.getCell(join.cellId);
    const target = doc.getCell(join.eportCellId);
    if (!source || !target) continue;
    const points = joinPolyline(join, source, target);
    if (!points) continue;
    const parts = joinStub(points, hidden.has(source.regionId), hidden.has(target.regionId));
    if (!parts) continue;
    for (const point of parts.points) add(point);
    if (parts.isStub) for (const point of stubTick(parts.points, STUB_TICK_MM)) add(point);
  }
  return bounds;
}

export class SvgExporter {
  static build(doc: TecscdeDocument, currentView: CanvasView, range: SvgExportRange, title: string): ExportedSvg {
    const view: CanvasView = { ...currentView, zoom: 1, gridVisible: false };
    const bounds = range === "content" ? diagramBounds(doc, view.hiddenRegionIds) : undefined;
    const paper = bounds === undefined;
    const content = doc.paper.contentSize();
    const left = paper ? -PAPER_MARGIN_MM : bounds.minX - CONTENT_MARGIN_MM;
    const top = paper ? -PAPER_MARGIN_MM : bounds.minY - CONTENT_MARGIN_MM;
    const widthMm = paper ? content.width + 2 * PAPER_MARGIN_MM : bounds.maxX - bounds.minX + 2 * CONTENT_MARGIN_MM;
    const heightMm = paper ? content.height + 2 * PAPER_MARGIN_MM : bounds.maxY - bounds.minY + 2 * CONTENT_MARGIN_MM;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    const renderer = new SvgRenderer(svg);
    renderer.render(doc, view, SelectionState.empty());
    svg.querySelector("#grid")?.remove();
    svg.querySelector("#selection-overlay")?.remove();
    svg.querySelector("#join-preview")?.remove();
    const art = document.createElementNS(SVG_NS, "g");
    art.setAttribute("transform", `translate(${-left * MM_TO_PX}, ${-top * MM_TO_PX})`);
    while (svg.firstChild) art.appendChild(svg.firstChild);

    const titleEl = document.createElementNS(SVG_NS, "title");
    titleEl.textContent = title;
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = SVG_STYLES;
    svg.append(titleEl, style, art);

    if (paper) {
      const frame = document.createElementNS(SVG_NS, "rect");
      frame.setAttribute("class", "export-frame");
      frame.setAttribute("x", String(PAPER_MARGIN_MM * MM_TO_PX));
      frame.setAttribute("y", String(PAPER_MARGIN_MM * MM_TO_PX));
      frame.setAttribute("width", String(content.width * MM_TO_PX));
      frame.setAttribute("height", String(content.height * MM_TO_PX));
      svg.appendChild(frame);
      const name = document.createElementNS(SVG_NS, "text");
      name.setAttribute("class", "export-filename");
      name.setAttribute("text-anchor", "end");
      name.setAttribute("x", String((widthMm - PAPER_MARGIN_MM) * MM_TO_PX));
      name.setAttribute("y", String((heightMm - 3) * MM_TO_PX));
      name.textContent = title;
      svg.appendChild(name);
    }

    svg.setAttribute("width", `${widthMm}mm`);
    svg.setAttribute("height", `${heightMm}mm`);
    svg.setAttribute("viewBox", `0 0 ${widthMm * MM_TO_PX} ${heightMm * MM_TO_PX}`);
    return { svg: new XMLSerializer().serializeToString(svg), widthMm, heightMm };
  }
}

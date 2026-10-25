/** @vitest-environment happy-dom */
// DT-EL internal spec 6.4: search decoration is independent of selection.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asRegionId } from "../../src/renderer/model/ids";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import { defaultCanvasView, pxPerMm, SelectionState } from "../../src/renderer/render/view";
import type { CanvasView } from "../../src/renderer/render/view";
import type { SearchHighlights } from "../../src/renderer/render/search-highlights";
import { moveBarBars } from "../../src/renderer/model/geometry";

const types = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf8");

function setup() {
  const doc = CdlDocumentLoader.loadSources([
    { text: types, fileName: "types.cdl", editable: false },
    { text: "region A { cell tLogger l1 {}; }; region B { cell tController c1 { cLog = l1.eLog; }; };", fileName: "main.cde", editable: true },
  ]).document;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const renderer = new SvgRenderer(svg);
  const join = doc.joinValues()[0]!;
  const highlights: SearchHighlights = { cellIds: new Set(doc.cellValues().map(c => c.id)), joinIds: new Set([join.id]) };
  const group = () => svg.querySelector<SVGGElement>(`[data-join-id='${join.id}']`)!;
  return { doc, svg, renderer, join, highlights, group };
}

describe("search highlights (6.4)", () => {
  it.each([0.05, 1, 2])("draws independent cell outlines and join underlays at zoom %s", (zoom) => {
    const { doc, svg, renderer, join, highlights, group } = setup();
    const cell = doc.getCell(asCellId("l1"))!;
    const view: CanvasView = { ...defaultCanvasView(), zoom, emphasizeCellName: true, regionColors: new Map([[cell.regionId, "#123456"]]) };
    renderer.render(doc, view, SelectionState.ofCells([cell.id]), { searchHighlights: highlights });
    const halo = svg.querySelector<SVGRectElement>(".search-highlight-cell")!;
    expect(svg.querySelectorAll(".search-highlight-cell")).toHaveLength(2);
    expect(Number(halo.getAttribute("x"))).toBeCloseTo((cell.x - 0.8) * pxPerMm(view));
    expect(Number(halo.getAttribute("width"))).toBeCloseTo((cell.width + 1.6) * pxPerMm(view));
    expect(halo.getAttribute("stroke-dasharray")).toBe("6 3");
    expect(halo.getAttribute("stroke-width")).toBe("3");
    expect(halo.nextElementSibling?.classList.contains("cell-rect")).toBe(true);
    expect(svg.querySelector(".region-tab")?.getAttribute("fill")).toBe("#123456");
    expect(svg.querySelector(".cell-label.emphasized")).not.toBeNull();
    const underlay = group().querySelector(".search-highlight-join")!;
    expect(underlay.getAttribute("points")).toBe(group().querySelector(".join-line")!.getAttribute("points"));
    expect(underlay.nextElementSibling?.classList.contains("join-line")).toBe(true);
    expect(underlay.getAttribute("stroke-width")).toBe("6");
    for (const shape of Array.from(svg.querySelectorAll(".search-highlight"))) {
      expect(shape.getAttribute("stroke")).toBe("#b45309");
      expect(shape.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      expect(shape.getAttribute("pointer-events")).toBe("none");
      expect(shape.getAttribute("aria-hidden")).toBe("true");
    }
    expect(svg.querySelector("#selection-overlay .selection-outline")).not.toBeNull();
    renderer.render(doc, view, SelectionState.ofJoin(join.id), { searchHighlights: highlights });
    expect(svg.querySelectorAll(".search-highlight-cell")).toHaveLength(2);
    expect(svg.querySelector("#selection-overlay .join-selected")).not.toBeNull();
  });

  it("updates search without model/view changes and reuses unchanged matches", () => {
    const { doc, svg, renderer, highlights } = setup();
    const view = defaultCanvasView();
    renderer.render(doc, view, SelectionState.empty());
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: highlights });
    const halo = svg.querySelector(".search-highlight-cell");
    expect(halo).not.toBeNull();
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: { cellIds: new Set(highlights.cellIds), joinIds: new Set(highlights.joinIds) } });
    expect(svg.querySelector(".search-highlight-cell")).toBe(halo);
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: { cellIds: new Set(), joinIds: highlights.joinIds } });
    expect(svg.querySelector(".search-highlight-cell")).toBeNull();
    expect(svg.querySelector(".search-highlight-join")).not.toBeNull();
    renderer.render(doc, view, SelectionState.empty());
    expect(svg.querySelector(".search-highlight")).toBeNull();
  });

  it("uses only visible stub geometry and removes hidden decorations", () => {
    const { doc, svg, renderer, highlights, group } = setup();
    const view: CanvasView = { ...defaultCanvasView(), hiddenRegionIds: new Set([asRegionId("::A")]) };
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: highlights });
    expect(svg.querySelector("[data-cell-id='l1'] .search-highlight")).toBeNull();
    expect(group().querySelector(".search-highlight")!.getAttribute("points")).toBe(group().querySelector(".join-stub")!.getAttribute("points"));
    renderer.render(doc, { ...view, hiddenRegionIds: new Set([asRegionId("::A"), asRegionId("::B")]) }, SelectionState.empty(), { searchHighlights: highlights });
    expect(svg.querySelector(".search-highlight")).toBeNull();
    renderer.render(doc, defaultCanvasView(), SelectionState.empty(), { searchHighlights: highlights });
    expect(svg.querySelectorAll(".search-highlight")).toHaveLength(3);
    expect(group().querySelector(".join-stub")).toBeNull();
  });

  it("follows drag and bar previews, survives search redraw, and restores confirmed points", () => {
    const { doc, svg, renderer, highlights, join, group } = setup();
    const view = defaultCanvasView();
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: highlights });
    renderer.setDragPreview(new Set([asCellId("l1")]), 12, 18);
    expect(svg.querySelector(".search-highlight-cell")!.parentElement!.getAttribute("transform")).toBe("translate(12, 18)");
    renderer.clearDragPreview();
    expect(svg.querySelector(".search-highlight-cell")!.parentElement!.hasAttribute("transform")).toBe(false);
    const original = group().querySelector(".join-line")!.getAttribute("points");
    const bars = moveBarBars(join.bars, 1, join.bars[1]!.fixed + 12)!;
    expect(bars).toBeDefined();
    renderer.setJoinBarPreview(join, bars, doc.getCell(join.cellId)!, doc.getCell(join.eportCellId)!, view);
    const preview = group().querySelector(".join-line")!.getAttribute("points");
    expect(preview).not.toBe(original);
    expect(group().querySelector(".search-highlight-join")!.getAttribute("points")).toBe(preview);
    renderer.render(doc, view, SelectionState.empty());
    expect(group().querySelector(".join-line")!.getAttribute("points")).toBe(preview);
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: highlights });
    expect(group().querySelector(".search-highlight-join")!.getAttribute("points")).toBe(preview);
    renderer.clearJoinBarPreview();
    expect(group().querySelector(".join-line")!.getAttribute("points")).toBe(original);
    expect(group().querySelector(".search-highlight-join")!.getAttribute("points")).toBe(original);
  });

  it("drops old decorations when elements are deleted or a document is replaced", () => {
    const { doc, svg, renderer, highlights } = setup();
    renderer.render(doc, defaultCanvasView(), SelectionState.empty(), { searchHighlights: highlights });
    const deleted = doc.withoutCell(asCellId("l1"));
    renderer.render(deleted, defaultCanvasView(), SelectionState.empty());
    expect(svg.querySelector("[data-cell-id='l1']")).toBeNull();
    expect(svg.querySelector(".search-highlight")).toBeNull();
    renderer.render(CdlDocumentLoader.loadSingle("cell tOther replacement {};", "other.cde").document, defaultCanvasView(), SelectionState.empty());
    expect(svg.querySelector(".search-highlight")).toBeNull();
    expect(svg.querySelector("[data-cell-id='c1']")).toBeNull();
  });

  it("keeps stub geometry and tick aligned during a hidden-end preview and restores both", () => {
    const { doc, renderer, highlights, join, group } = setup();
    const view: CanvasView = { ...defaultCanvasView(), hiddenRegionIds: new Set([asRegionId("::A")]) };
    renderer.render(doc, view, SelectionState.empty(), { searchHighlights: highlights });
    const confirmed = group().innerHTML;
    const bars = moveBarBars(join.bars, 1, join.bars[1]!.fixed + 20)!;
    renderer.setJoinBarPreview(join, bars, doc.getCell(join.cellId)!, doc.getCell(join.eportCellId)!, view);
    const stub = group().querySelector(".join-stub")!;
    expect(group().querySelector(".search-highlight-join")!.getAttribute("points")).toBe(stub.getAttribute("points"));
    const last = stub.getAttribute("points")!.split(" ").at(-1)!.split(",").map(Number);
    const tick = group().querySelector(".join-stub-tick")!;
    expect((Number(tick.getAttribute("x1")) + Number(tick.getAttribute("x2"))) / 2).toBeCloseTo(last[0]!);
    expect((Number(tick.getAttribute("y1")) + Number(tick.getAttribute("y2"))) / 2).toBeCloseTo(last[1]!);
    renderer.clearJoinBarPreview();
    expect(group().innerHTML).toBe(confirmed);
  });
});

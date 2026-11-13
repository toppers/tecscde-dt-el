/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asRegionId } from "../../src/renderer/model/ids";
import { DisplayFilters } from "../../src/renderer/view-state/display-filters";
import { ViewState } from "../../src/renderer/view-state/view-state";
import { defaultCanvasView, SelectionState } from "../../src/renderer/render/view";
import { isActiveCell, isCellVisible } from "../../src/renderer/render/cell-visibility";
import { HitTester } from "../../src/renderer/render/hit-tester";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import { CellRenderer } from "../../src/renderer/render/cell-renderer";
import { Cell } from "../../src/renderer/model/cell";
import { CELL_COLORS, resolveCellAppearance } from "../../src/renderer/render/cell-appearance";

function fixture() {
  const doc = CdlDocumentLoader.loadSingle([
    "signature s { void f(void); };",
    "[active] celltype tActive { call s c; entry s e; };",
    "celltype tPassive { call s c; entry s e; };",
    "region Outer {",
    "region A { cell tActive Active { c = Passive.e; }; };",
    "region B { cell tPassive Passive { c = Active.e; }; };",
    "};",
  ].join("\n"), "main.cdl").document;
  const active = doc.getCell(asCellId("Active"))!;
  const passive = doc.getCell(asCellId("Passive"))!;
  return { doc, active, passive };
}

describe("active-only state and visibility", () => {
  it("derives active from the type rather than selection or editing permission", () => {
    const { doc, active, passive } = fixture();
    expect(isActiveCell(doc, active)).toBe(true);
    expect(isActiveCell(doc, passive)).toBe(false);
    expect(isActiveCell(doc, Cell.create({ ...active, editable: false }))).toBe(true);
    expect(isActiveCell(doc, Cell.create({ ...active, celltypeName: "missing" }))).toBe(false);
  });
  it("retains activeOnly and regionOutlineMode through every immutable view update", () => {
    expect(DisplayFilters.allVisible().activeOnly).toBe(false);
    const filters = DisplayFilters.allVisible().withActiveOnly(true);
    const variants = [filters.withRegionHidden(asRegionId("::A"), true), filters.withRegionsRevealed([]),
      filters.withAllRegionsShown(), filters.withColorByRegion(true), filters.withShowSignatureNames(false), filters.withEmphasizeCellName(true)];
    expect(variants.every((value) => value.activeOnly)).toBe(true);
    expect(filters.equals(DisplayFilters.allVisible())).toBe(false);
    const view = ViewState.initial().withFilters(filters).withRegionOutlineMode(true);
    const updates = [view.zoomAt({ x: 0, y: 0 }, 1.1), view.resetZoom(), view.panBy({ x: 2, y: 3 }),
      view.panTo({ x: 4, y: 5 }), view.toggleGrid(), view.withFilters(filters), view.withSearchQuery("Active")];
    expect(updates.every((value) => value.regionOutlineMode && value.filters.activeOnly)).toBe(true);
    expect(view.toCanvasView(fixture().doc.regions)).toMatchObject({ activeOnly: true, regionOutlineMode: true });
    expect(defaultCanvasView()).toMatchObject({ activeOnly: false, regionOutlineMode: false });
  });
  it("uses the intersection of the active-only and ancestor-region filters", () => {
    const { doc, active, passive } = fixture();
    const view = ViewState.initial().withFilters(DisplayFilters.allVisible().withActiveOnly(true)).toCanvasView(doc.regions);
    expect(isCellVisible(doc, active, view)).toBe(true);
    expect(isCellVisible(doc, passive, view)).toBe(false);
    const hidden = ViewState.initial().withFilters(DisplayFilters.allVisible().withActiveOnly(true)
      .withRegionHidden(asRegionId("::Outer"), true)).toCanvasView(doc.regions);
    expect(isCellVisible(doc, active, hidden)).toBe(false);
  });
  it("shares visibility between cells, hit tests, stubs and selection overlays", () => {
    const { doc, active, passive } = fixture();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const renderer = new SvgRenderer(svg);
    const selection = SelectionState.ofCells([active.id, passive.id]);
    const view = { ...defaultCanvasView(), activeOnly: true };
    renderer.render(doc, view, selection);
    expect(svg.querySelector<SVGGElement>("[data-cell-id='Active']")!.style.display).toBe("");
    expect(svg.querySelector<SVGGElement>("[data-cell-id='Passive']")!.style.display).toBe("none");
    expect(svg.querySelectorAll("#selection-overlay .selection-outline")).toHaveLength(1);
    expect(selection.cellIds.size).toBe(2);
    const hit = new HitTester(doc, view);
    expect(hit.hitTest({ x: passive.x + passive.width / 2, y: passive.y + passive.height / 2 })).toEqual({ kind: "none" });
    expect(hit.hitTestRect({ x: -100, y: -100 }, { x: 1000, y: 1000 })).toEqual([active.id]);
    expect(svg.querySelectorAll(".join-stub")).toHaveLength(2);
    const hidden = { ...view, hiddenRegionIds: new Set([active.regionId]) };
    renderer.render(doc, hidden, selection);
    expect(svg.querySelectorAll("#selection-overlay .selection-outline")).toHaveLength(0);
    expect(Array.from(svg.querySelectorAll<SVGGElement>("[data-join-id]")).every((group) => group.style.display === "none")).toBe(true);
  });
  it("hides region-filtered selection outlines even when activeOnly is off", () => {
    const { doc, active } = fixture();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    new SvgRenderer(svg).render(doc, { ...defaultCanvasView(), hiddenRegionIds: new Set([active.regionId]) }, SelectionState.ofCells([active.id]));
    expect(svg.querySelector("#selection-overlay .selection-outline")).toBeNull();
  });
});

describe("independent active fill and incomplete/read-only frame", () => {
  it.each([true, false])("uses active fill=%s while unresolved controls only the frame", (active) => {
    const cell = fixture().active;
    for (const readOnly of [false, true]) for (const incomplete of [false, true]) {
      const state = resolveCellAppearance(active, readOnly, incomplete);
      expect(state.fill).toBe(active ? CELL_COLORS.activeFill : readOnly ? CELL_COLORS.readOnlyFill : CELL_COLORS.fill);
      expect(state.stroke).toBe(incomplete ? CELL_COLORS.warningStroke : readOnly ? CELL_COLORS.readOnlyStroke : CELL_COLORS.stroke);
      const element = new CellRenderer().createElement(Cell.create({ ...cell, editable: !readOnly, celltypeUnresolved: incomplete }),
        { view: defaultCanvasView(), active });
      const rect = element.querySelector<SVGRectElement>(".cell-rect")!;
      expect(rect.getAttribute("fill")).toBe(state.fill); expect(rect.style.fill).toBe(state.fill);
      expect(rect.getAttribute("stroke")).toBe(state.stroke);
      expect(rect.classList.contains("active")).toBe(active);
      expect(rect.classList.contains("readonly")).toBe(readOnly);
      expect(rect.classList.contains("unresolved")).toBe(incomplete);
    }
  });
  it("uses label/background color combinations with at least 4.5:1 contrast", () => {
    const luminance = (color: string) => {
      const rgb = color.match(/[0-9a-f]{2}/gi)!.map((part) => parseInt(part, 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    };
    for (const fill of [CELL_COLORS.fill, CELL_COLORS.readOnlyFill, CELL_COLORS.activeFill]) {
      for (const text of [CELL_COLORS.label, CELL_COLORS.typeLabel]) {
        expect((luminance(fill) + 0.05) / (luminance(text) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

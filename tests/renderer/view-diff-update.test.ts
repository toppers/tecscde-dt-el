/**
 * @vitest-environment happy-dom
 */
// 三者相違一覧 3-10・3-2（V0.2.6 段5）: 結合強調の差分更新と、リージョン矩形モードの色帯。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CellRenderer } from "../../src/renderer/render/cell-renderer";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import { defaultCanvasView, SelectionState, type CanvasView } from "../../src/renderer/render/view";
import { ViewState } from "../../src/renderer/view-state";
import type { JoinId } from "../../src/renderer/model/ids";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");
const loadDoc = () => CdlDocumentLoader.loadSources([
  { text: celltypesText, fileName: "celltypes.cdl", editable: false },
  { text: mainText, fileName: "main.cde", editable: true },
]).document;

function newSvg(): SVGSVGElement {
  document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  return document.querySelector("svg")!;
}

describe("結合強調の差分更新（3-10）", () => {
  it("adds and removes the join-focus class when only the focused join set changes", () => {
    const doc = loadDoc();
    const join = doc.joinValues()[0];
    expect(join).toBeDefined();
    const svg = newSvg();
    const renderer = new SvgRenderer(svg);
    const group = (): SVGGElement => svg.querySelector<SVGGElement>(`[data-join-id='${join!.id}']`)!;
    const withFocus = (focused?: ReadonlySet<JoinId>): CanvasView => ({ ...defaultCanvasView(), focusedJoinIds: focused });

    renderer.render(doc, withFocus(), SelectionState.empty());
    expect(group().querySelector(".join-focus")).toBeNull();

    renderer.render(doc, withFocus(new Set([join!.id])), SelectionState.empty());
    expect(group().querySelector(".join-focus")).not.toBeNull();

    renderer.render(doc, withFocus(new Set()), SelectionState.empty());
    expect(group().querySelector(".join-focus")).toBeNull();
  });
});

describe("リージョン矩形モードと色帯（3-2）", () => {
  it("supplies the region colors for the outlines but not the cell bands when color-by-region is off", () => {
    const regions = loadDoc().regions;
    const view = ViewState.initial().withRegionOutlineMode(true).toCanvasView(regions);
    expect(view.regionColors).not.toBeNull();
    expect(view.regionBands).toBe(false);
  });

  it("supplies the bands when color-by-region is on, with or without the outline mode", () => {
    const regions = loadDoc().regions;
    const filters = ViewState.initial().filters.withColorByRegion(true);
    const colored = ViewState.initial().withFilters(filters);
    expect(colored.toCanvasView(regions).regionBands).not.toBe(false);
    expect(colored.withRegionOutlineMode(true).toCanvasView(regions).regionBands).not.toBe(false);
    expect(colored.toCanvasView(regions).regionColors).not.toBeNull();
  });

  it("draws no tab in the outline mode alone, and draws it when the bands are on", () => {
    const doc = loadDoc();
    const cell = doc.cellValues()[0]!;
    const colors = new Map([[cell.regionId, "#123456"]]);
    const renderer = new CellRenderer();
    const outlineOnly: CanvasView = { ...defaultCanvasView(), regionColors: colors, regionBands: false, regionOutlineMode: true };
    expect(renderer.createElement(cell, { view: outlineOnly }).querySelector(".region-tab")).toBeNull();
    expect(renderer.createElement(cell, { view: { ...outlineOnly, regionBands: true } }).querySelector(".region-tab")).not.toBeNull();
  });
});

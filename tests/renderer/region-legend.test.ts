/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.6 — 色分け表示の凡例。

import { afterEach, describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { RegionLegendView } from "../../src/renderer/app/region-legend";
import { asRegionId } from "../../src/renderer/model/ids";
import { regionColor } from "../../src/renderer/view-state/region-colors";

const CDL = `
namespace N {
  region A { cell tLogger c1 {}; region A1 { cell tLogger c2 {}; }; };
  region B { cell tLogger c3 {}; };
};`;

function mount(): { store: AppStore; root: HTMLElement; legend: RegionLegendView } {
  const { document: model } = CdlDocumentLoader.loadSingle(CDL, "main.cde");
  const store = new AppStore(model);
  document.body.innerHTML = `<div id="region-legend" hidden></div>`;
  const root = document.querySelector<HTMLElement>("#region-legend")!;
  const legend = new RegionLegendView(root, store);
  store.subscribe(() => legend.render());
  legend.render();
  return { store, root, legend };
}

const items = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".legend-item"));
const colorOn = (store: AppStore): void =>
  store.setView(store.view.withFilters(store.view.filters.withColorByRegion(true)));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RegionLegendView — 6B.6", () => {
  it("is hidden while color-by-region is off", () => {
    const { root } = mount();
    expect(root.hidden).toBe(true);
    expect(items(root).length).toBe(0);
  });

  it("lists every non-root region with its color once color-by-region is on", () => {
    const { store, root } = mount();
    colorOn(store);
    expect(root.hidden).toBe(false);
    expect(items(root).map((i) => i.dataset["regionId"])).toEqual(["::N", "::N::A", "::N::A::A1", "::N::B"]);
    const swatch = root.querySelector<HTMLElement>(".legend-item[data-region-id='::N::B'] .region-swatch")!;
    expect(swatch.style.background).not.toBe("");
    expect(root.textContent).toContain("::N::A::A1");
    expect(regionColor(asRegionId("::N::B"))).toBeDefined();
  });

  it("omits hidden regions (including descendants of a hidden one)", () => {
    const { store, root } = mount();
    colorOn(store);
    store.setView(store.view.withFilters(store.view.filters.withRegionHidden(asRegionId("::N::A"), true)));
    expect(items(root).map((i) => i.dataset["regionId"])).toEqual(["::N", "::N::B"]);
  });

  it("hides itself again when color-by-region is turned off, or nothing is left to list", () => {
    const { store, root } = mount();
    colorOn(store);
    store.setView(store.view.withFilters(store.view.filters.withColorByRegion(false)));
    expect(root.hidden).toBe(true);
    colorOn(store);
    store.setView(store.view.withFilters(store.view.filters.withRegionHidden(asRegionId("::N"), true)));
    expect(root.hidden).toBe(true);
  });

  it("is hidden for a document without regions", () => {
    const store = new AppStore();
    document.body.innerHTML = `<div id="region-legend"></div>`;
    const root = document.querySelector<HTMLElement>("#region-legend")!;
    colorOn(store);
    new RegionLegendView(root, store).render();
    expect(root.hidden).toBe(true);
  });
});

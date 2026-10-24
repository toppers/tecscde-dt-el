/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.6 — リージョン木のポップオーバー。

import { afterEach, describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { RegionFilterPanel } from "../../src/renderer/app/region-filter-panel";
import { asRegionId } from "../../src/renderer/model/ids";

const CDL = `
namespace N {
  region A { cell tLogger c1 {}; region A1 { cell tLogger c2 {}; }; };
  region B { cell tLogger c3 {}; };
};`;

let panel: RegionFilterPanel | undefined;

function mount(): { store: AppStore; root: HTMLElement } {
  const { document: model } = CdlDocumentLoader.loadSingle(CDL, "main.cde");
  const store = new AppStore(model);
  document.body.innerHTML = `<div id="region-filter">
    <button type="button" id="region-filter-toggle">リージョン</button>
    <div id="region-filter-popover" hidden></div></div>`;
  const root = document.querySelector<HTMLElement>("#region-filter")!;
  panel = new RegionFilterPanel(root, store);
  store.subscribe(() => panel?.render());
  panel.render();
  return { store, root };
}

const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("#region-filter-toggle")!;
const popover = (root: HTMLElement) => root.querySelector<HTMLElement>("#region-filter-popover")!;
const row = (root: HTMLElement, id: string) =>
  popover(root).querySelector<HTMLInputElement>(`input[data-region-id="${id}"]`)!;

afterEach(() => {
  panel?.dispose();
  panel = undefined;
  document.body.innerHTML = "";
});

describe("RegionFilterPanel — 6B.6", () => {
  it("is closed initially and opens/closes with the button", () => {
    const { root } = mount();
    expect(popover(root).hidden).toBe(true);
    toggle(root).click();
    expect(popover(root).hidden).toBe(false);
    toggle(root).click();
    expect(popover(root).hidden).toBe(true);
  });

  it("lists non-root regions in tree order with cell counts, all checked", () => {
    const { root } = mount();
    toggle(root).click();
    const boxes = Array.from(popover(root).querySelectorAll<HTMLInputElement>("input[data-region-id]"));
    const ids = boxes.map((i) => i.dataset["regionId"]);
    expect(ids).toEqual(["::N", "::N::A", "::N::A::A1", "::N::B"]);
    expect(boxes.every((i) => i.checked)).toBe(true);
    expect(popover(root).textContent).toContain("A1");
  });

  it("unchecking a region hides it in the store; descendants show disabled + unchecked", () => {
    const { store, root } = mount();
    toggle(root).click();
    row(root, "::N::A").checked = false;
    row(root, "::N::A").dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.view.filters.hiddenRegions.has(asRegionId("::N::A"))).toBe(true);
    expect(row(root, "::N::A::A1").disabled).toBe(true);
    expect(row(root, "::N::A::A1").checked).toBe(false);
    expect(row(root, "::N::B").disabled).toBe(false);
    expect(toggle(root).textContent).toContain("1件非表示");
  });

  it("re-checking restores; 'show all' clears everything", () => {
    const { store, root } = mount();
    toggle(root).click();
    for (const id of ["::N::A", "::N::B"]) {
      row(root, id).checked = false;
      row(root, id).dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(store.view.filters.hiddenRegions.size).toBe(2);
    row(root, "::N::B").checked = true;
    row(root, "::N::B").dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.view.filters.hiddenRegions.size).toBe(1);
    popover(root).querySelector<HTMLButtonElement>("[data-role='show-all']")!.click();
    expect(store.view.filters.isAllVisible).toBe(true);
    expect(toggle(root).textContent).toBe("リージョン");
  });

  it("keeps the same checkbox elements across renders (focus is not lost)", () => {
    const { store, root } = mount();
    toggle(root).click();
    const before = row(root, "::N::B");
    store.setView(store.view.withFilters(store.view.filters.withRegionHidden(asRegionId("::N::A"), true)));
    expect(row(root, "::N::B")).toBe(before);
  });

  it("shows a color swatch only while color-by-region is on", () => {
    const { store, root } = mount();
    toggle(root).click();
    expect(popover(root).querySelector(".region-swatch")).toBeNull();
    store.setView(store.view.withFilters(store.view.filters.withColorByRegion(true)));
    expect(popover(root).querySelectorAll(".region-swatch").length).toBe(4);
  });

  it("closes on Escape and on an outside mousedown", () => {
    const { root } = mount();
    toggle(root).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover(root).hidden).toBe(true);
    toggle(root).click();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popover(root).hidden).toBe(true);
    toggle(root).click();
    popover(root).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popover(root).hidden).toBe(false);
  });

  it("disables the button when the document has no regions", () => {
    const store = new AppStore();
    document.body.innerHTML = `<div id="region-filter"><button type="button" id="region-filter-toggle"></button><div id="region-filter-popover" hidden></div></div>`;
    const root = document.querySelector<HTMLElement>("#region-filter")!;
    panel = new RegionFilterPanel(root, store);
    panel.render();
    expect(toggle(root).disabled).toBe(true);
  });
});

/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { SearchBoxView } from "../../src/renderer/app/search-box";
import { searchDocument } from "../../src/renderer/view-state/search";
import { asCellId, asRegionId } from "../../src/renderer/model/ids";

function setup(query: string) {
  const doc = CdlDocumentLoader.loadSingle([
    "signature s { void f(void); };",
    "[active] celltype tActive { call s c; entry s e; }; celltype tPassive { entry s e; };",
    "region A { cell tActive Active { c = Passive.e; }; }; region B { cell tPassive Passive {}; };",
  ].join("\n"), "main.cdl").document;
  const store = new AppStore(doc);
  store.setView(store.view.withFilters(store.view.filters.withActiveOnly(true)).withSearchQuery(query));
  const root = document.createElement("div");
  root.innerHTML = '<input id="search-input"><span id="search-count"></span><div id="search-results"></div>';
  document.body.append(root);
  const view = new SearchBoxView(root, store);
  const render = () => {
    const canvas = store.view.toCanvasView(store.getDocument().regions);
    view.render(searchDocument(store.getDocument(), store.view.searchQuery, canvas.hiddenRegionIds, canvas.activeOnly));
  };
  const unsubscribe = store.subscribe(render);
  render();
  return { store, doc, root, view, render, cleanup: () => { unsubscribe(); root.remove(); } };
}

describe("active-only search reveal", () => {
  it("searches the entire model, reveals a non-active hit and retains its mark after synchronous redraws", () => {
    const { store, doc, root, view, cleanup } = setup("Passive");
    try {
      const history = store.history; const dirty = store.isDirty();
      expect(root.querySelectorAll(".search-hit")).toHaveLength(2);
      expect(root.querySelector(".search-hit.revealed")).not.toBeNull();
      view.next();
      expect(store.view.filters.activeOnly).toBe(false);
      expect(store.selection.cellIds.has(asCellId("Passive"))).toBe(true);
      expect(root.querySelector(".search-hit.revealed")).not.toBeNull();
      expect(store.getDocument()).toBe(doc); expect(store.history).toBe(history); expect(store.isDirty()).toBe(dirty);
      store.setView(store.view.withSearchQuery("Pass"));
      expect(root.querySelector(".search-hit.revealed")).toBeNull();
    } finally { cleanup(); }
  });

  it("leaves activeOnly enabled when only the active target's region needs revealing", () => {
    const { store, view, root, cleanup } = setup("Active");
    try {
      store.setView(store.view.withFilters(store.view.filters.withRegionHidden(asRegionId("::A"), true)));
      view.next();
      expect(store.view.filters.activeOnly).toBe(true);
      expect(store.view.filters.hiddenRegions.has(asRegionId("::A"))).toBe(false);
      expect(root.querySelector(".search-hit.revealed")).not.toBeNull();
    } finally { cleanup(); }
  });

  it("disables activeOnly when either endpoint of a selected join is non-active", () => {
    const { store, root, doc, cleanup } = setup("Passive");
    try {
      const hits = searchDocument(doc, "Passive", new Set(), true);
      const index = hits.findIndex((hit) => hit.kind === "join");
      root.querySelector<HTMLElement>('[data-hit-index="' + index + '"]')!.click();
      expect(store.view.filters.activeOnly).toBe(false);
      expect(store.selection.joinIds.size).toBe(1);
      expect(root.querySelector('[data-hit-index="' + index + '"]')!.classList.contains("revealed")).toBe(true);
    } finally { cleanup(); }
  });
});

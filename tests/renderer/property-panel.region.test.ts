/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

describe("property panel region selector", () => {
  it("changes an editable cell's region and follows undo/redo", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(`
namespace N {
  region A { cell tLogger c1 {}; };
  region B { };
};`, "main.cde");
    const store = new AppStore(model);
    store.setSelection(SelectionState.ofCells([asCellId("c1")]));
    const root = document.createElement("div");
    const panel = new PropertyPanelView(root, store);
    panel.render();
    const select = root.querySelector<HTMLSelectElement>('select[aria-label="region"]')!;
    expect(select.value).toBe("::N::A");
    select.value = "::N::B";
    select.dispatchEvent(new Event("change"));
    expect(store.getDocument().getCell(asCellId("c1"))?.regionId).toBe("::N::B");
    store.undo();
    expect(store.getDocument().getCell(asCellId("c1"))?.regionId).toBe("::N::A");
    store.redo();
    expect(store.getDocument().getCell(asCellId("c1"))?.regionId).toBe("::N::B");
  });

  it("disables the selector for a reference-only cell", () => {
    const { document: model } = CdlDocumentLoader.loadSources([
      { text: "region Shared { cell tLogger ref {}; };", fileName: "ref.cdl", editable: false },
      { text: "region Local { cell tLogger own {}; };", fileName: "main.cde", editable: true },
    ]);
    const store = new AppStore(model);
    store.setSelection(SelectionState.ofCells([asCellId("ref")]));
    const root = document.createElement("div");
    new PropertyPanelView(root, store).render();
    expect(root.querySelector<HTMLSelectElement>('select[aria-label="region"]')?.disabled).toBe(true);
  });
});

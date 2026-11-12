/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

describe("property panel attribute options combo input (#14)", () => {
  const cdl = `
celltype tSwitch {
  attr {
    bool_t enabled;
    char_t *label;
  };
};
cell tSwitch c1 {
  enabled = true;
  label = "Switch 1";
};
cell tSwitch c2 {
  enabled = false;
  label = "Switch 2";
};
`;

  it("renders select combo for attributes with choices and input for free-form attributes", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const store = new AppStore(model);
    store.setSelection(SelectionState.ofCells([asCellId("c1")]));
    const root = document.createElement("div");
    const panel = new PropertyPanelView(root, store);
    panel.render();

    // enabled has choices (true, false) -> rendered as select
    const enabledSelect = root.querySelector<HTMLSelectElement>('select[aria-label="enabled"]');
    expect(enabledSelect).not.toBeNull();
    expect(enabledSelect?.value).toBe("true");
    const options = Array.from(enabledSelect!.options).map((o) => o.value);
    expect(options).toEqual(["true", "false"]);

    // label has no choices -> rendered as text input
    const labelInput = root.querySelector<HTMLInputElement>('input[aria-label="label"]');
    expect(labelInput).not.toBeNull();
    expect(labelInput?.value).toBe('"Switch 1"');

    // Change combo selection
    enabledSelect!.value = "false";
    enabledSelect!.dispatchEvent(new Event("change"));
    expect(store.getDocument().getCell(asCellId("c1"))?.attrs.enabled).toBe("false");

    // Undo / Redo
    store.undo();
    expect(store.getDocument().getCell(asCellId("c1"))?.attrs.enabled).toBe("true");
    store.redo();
    expect(store.getDocument().getCell(asCellId("c1"))?.attrs.enabled).toBe("false");
  });

  it("handles multiple cell selection with attribute options combo", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const store = new AppStore(model);
    store.setSelection(SelectionState.ofCells([asCellId("c1"), asCellId("c2")]));
    const root = document.createElement("div");
    const panel = new PropertyPanelView(root, store);
    panel.render();

    const enabledSelect = root.querySelector<HTMLSelectElement>('select[aria-label="enabled"]');
    expect(enabledSelect).not.toBeNull();
    // Since c1.enabled=true and c2.enabled=false, placeholder "(複数)" is selected
    expect(enabledSelect?.value).toBe("");

    // Set both to "true"
    enabledSelect!.value = "true";
    enabledSelect!.dispatchEvent(new Event("change"));
    expect(store.getDocument().getCell(asCellId("c1"))?.attrs.enabled).toBe("true");
    expect(store.getDocument().getCell(asCellId("c2"))?.attrs.enabled).toBe("true");

    // Undo / Redo
    store.undo();
    expect(store.getDocument().getCell(asCellId("c1"))?.attrs.enabled).toBe("true");
    expect(store.getDocument().getCell(asCellId("c2"))?.attrs.enabled).toBe("false");
  });
});

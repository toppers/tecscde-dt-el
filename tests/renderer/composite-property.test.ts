/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

describe("composite unsupported syntax property", () => {
  it("shows only existence for unsupported syntax and clears it when selection changes", () => {
    const text = `celltype tInner { entry sTask eTask; };
composite tKnown {
  entry sTask eTask;
  cell tInner Inner {};
  composite.eTask => Inner.eTask;
};
composite tUnknown {
  entry sTask eTask;
  foo bar;
};
cell tKnown Known {};
cell tUnknown Unknown {};
`;
    const { document: model, diagnostics } = CdlDocumentLoader.loadSources([
      { text, fileName: "composite.cdl", editable: true },
    ]);
    expect(model.getCelltype("tKnown")?.hasUnsupportedSyntax).toBe(false);
    expect(model.getCelltype("tUnknown")?.hasUnsupportedSyntax).toBe(true);
    expect(model.getCell(asCellId("Unknown"))?.eports.map((port) => port.name)).toEqual(["eTask"]);
    expect(diagnostics.some((item) => item.code === W_CODES.COMPOSITE_UNSUPPORTED)).toBe(false);

    const store = new AppStore(model);
    const root = document.createElement("div");
    const panel = new PropertyPanelView(root, store);
    store.setSelection(SelectionState.ofCells([asCellId("Unknown")]));
    panel.render();
    expect(root.textContent).toContain("未対応構文があります。");
    expect(root.textContent).not.toContain("foo bar");
    expect(root.textContent).not.toContain("Inner");

    store.setSelection(SelectionState.ofCells([asCellId("Known")]));
    panel.render();
    expect(root.textContent).not.toContain("未対応構文があります。");
  });
});

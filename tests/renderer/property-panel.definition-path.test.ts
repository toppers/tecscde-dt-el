/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

// プロパティの一番下に、選択したセルを定義している CDL ファイルのフルパスを出す。
const DEFS = "signature sX { void run(void); };\ncelltype tA { attribute int_t n; call sX c; };\n";
const REF = { text: `${DEFS}cell tA fromRef { n = 1; };\n`, fileName: "ref.cdl", sourcePath: "E:\\proj\\lib\\ref.cdl", editable: false };
const MAIN = { text: "cell tA fromMain { n = 2; };\ncell tUnknown lost {};\n", fileName: "main.cdl", sourcePath: "E:\\proj\\main.cdl", editable: true };

function panelFor(cellName: string, sources: Parameters<typeof CdlDocumentLoader.loadSources>[0] = [REF, MAIN]) {
  const { document: model } = CdlDocumentLoader.loadSources(sources, {});
  const store = new AppStore(model);
  store.setSelection(SelectionState.ofCells([asCellId(cellName)]));
  const root = document.createElement("div");
  new PropertyPanelView(root, store).render();
  const field = root.querySelector<HTMLElement>(".prop-path");
  return { root, store, field };
}

describe("property panel: the defining CDL file of the selected cell", () => {
  it("shows the full path of the file that defines the cell, as the last item", () => {
    const { root, field } = panelFor("fromMain");

    expect(field).not.toBeNull();
    expect(field!.querySelector("label")?.textContent).toBe("定義ファイル");
    expect(field!.textContent).toContain("E:\\proj\\main.cdl");
    expect(root.lastElementChild).toBe(field);
  });

  it("shows the reference file's path for a cell defined in a read-only reference file", () => {
    const { field } = panelFor("fromRef");

    expect(field!.textContent).toContain("E:\\proj\\lib\\ref.cdl");
    expect(field!.textContent).not.toContain("E:\\proj\\main.cdl");
  });

  it("still shows the path when the celltype of the cell is unresolved", () => {
    const { field } = panelFor("lost");

    expect(field!.textContent).toContain("E:\\proj\\main.cdl");
  });

  it("says there is no path for a cell that is not from a file", () => {
    const { field } = panelFor("fromMain", [{ text: "cell tA fromMain {};\n", fileName: "main.cde", editable: true }]);

    expect(field!.textContent).toContain("パスなし");
  });

  it("shows nothing for an empty selection", () => {
    const { document: model } = CdlDocumentLoader.loadSources([MAIN], {});
    const root = document.createElement("div");
    new PropertyPanelView(root, new AppStore(model)).render();

    expect(root.querySelector(".prop-path")).toBeNull();
  });
});

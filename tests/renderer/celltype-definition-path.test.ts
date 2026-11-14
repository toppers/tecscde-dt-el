/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { CelltypeDetailsView } from "../../src/renderer/app/celltype-details";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CelltypeRef } from "../../src/renderer/model/celltype";

// セルタイプの詳細ダイアログの一番下に、そのセルタイプを定義している CDL ファイルのフルパスを出す。

let view: CelltypeDetailsView | undefined;
afterEach(() => { view?.dispose(); view = undefined; document.body.replaceChildren(); });

function mount() {
  document.body.innerHTML = '<button id="trigger">詳細</button><dialog><h2>セルタイプの詳細</h2><div class="celltype-details-content"></div><button class="celltype-details-close">閉じる</button></dialog>';
  const dialog = document.querySelector("dialog")!;
  const trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
  view = new CelltypeDetailsView(dialog);
  return { dialog, trigger, details: view };
}

const base = { cportTemplates: [], eportTemplates: [], attributeNames: ["attr"], hiddenRequirePortCount: 0 };

describe("celltype details: the full path of the defining CDL file", () => {
  it("shows the full path as the last section of the dialog content", () => {
    const { dialog, trigger, details } = mount();
    const path = "E:\\proj\\defs\\tDemo.cdl";
    details.open(CelltypeRef.create({ ...base, name: "tDemo", locale: "tDemo.cdl", definitionPath: path }), trigger);

    const sections = dialog.querySelectorAll(".celltype-details-content > section");
    const last = sections[sections.length - 1]!;
    expect(last.querySelector("h3")?.textContent).toBe("定義ファイル");
    expect(last.textContent).toContain(path);
    expect(dialog.querySelector(".celltype-details-content")!.lastElementChild).toBe(last);
  });

  it("says there is no path for a type without one (plugin-generated or not from a file)", () => {
    const { dialog, trigger, details } = mount();
    details.open(CelltypeRef.create({ ...base, name: "tGen", locale: "plugin:tmp_0.cdl" }), trigger);

    const last = dialog.querySelector(".celltype-details-content")!.lastElementChild!;
    expect(last.querySelector("h3")?.textContent).toBe("定義ファイル");
    expect(last.textContent).toContain("パスなし");
  });

  it("escapes the path", () => {
    const { dialog, trigger, details } = mount();
    details.open(CelltypeRef.create({ ...base, name: "tX", definitionPath: "<img src=x>.cdl" }), trigger);

    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.textContent).toContain("<img src=x>.cdl");
  });
});

describe("celltype definition path on load", () => {
  const TEXT = "signature sX { void run(void); };\ncelltype tA { call sX c; };\n";

  it("records the source path of the file that defines the celltype", () => {
    const { document: doc } = CdlDocumentLoader.loadSources(
      [{ text: TEXT, fileName: "defs.cdl", sourcePath: "E:\\proj\\defs.cdl", editable: true }],
      {},
    );
    expect(doc.getCelltype("tA")?.definitionPath).toBe("E:\\proj\\defs.cdl");
  });

  it("has no path for a plugin-generated celltype", () => {
    const { document: doc } = CdlDocumentLoader.loadSources(
      [{ text: TEXT, fileName: "plugin:tmp_0.cdl", editable: false, generated: true }],
      {},
    );
    expect(doc.getCelltype("tA")?.definitionPath).toBeUndefined();
  });
});

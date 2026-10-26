/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { CelltypeDetailsView } from "../../src/renderer/app/celltype-details";
import { CelltypeRef } from "../../src/renderer/model/celltype";

let view: CelltypeDetailsView | undefined;
afterEach(() => { view?.dispose(); view = undefined; document.body.replaceChildren(); });

function mount() {
  document.body.innerHTML = '<button id="trigger">詳細</button><dialog><h2>セルタイプの詳細</h2><div class="celltype-details-content"></div><button class="celltype-details-close">閉じる</button></dialog>';
  const dialog = document.querySelector("dialog")!;
  const trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
  view = new CelltypeDetailsView(dialog);
  return { dialog, trigger, details: view };
}

describe("CelltypeDetailsView", () => {
  it("shows only the public definition of composite/generated types and escapes all displayed values", () => {
    const { dialog, trigger, details } = mount();
    const type = CelltypeRef.create({
      name: "<img src=x>", locale: "plugin:generated.cdl",
      cportTemplates: [{ name: "cCall", signature: "::N::sCall", edgeSide: "LEFT", offset: 5, subscript: null, arraySize: 3 }],
      eportTemplates: [], attributeNames: ["attr"], hiddenRequirePortCount: 0,
      composite: { internalCells: [], portExports: [], rawText: "SECRET_INTERNAL_CDL" },
      hasUnsupportedSyntax: true,
    });
    details.open(type, trigger);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("<img src=x>");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.textContent).toContain("plugin:generated.cdl");
    expect(dialog.textContent).toContain("::N::sCall");
    expect(dialog.querySelector("tbody tr")?.textContent).toContain("3");
    expect(dialog.textContent).toContain("attr");
    expect(dialog.textContent).not.toContain("SECRET_INTERNAL_CDL");
    expect(dialog.textContent).not.toContain("未対応構文");
    dialog.querySelector<HTMLButtonElement>(".celltype-details-close")!.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("shows empty sections and closes an open modal when disposed", () => {
    const { dialog, trigger, details } = mount();
    details.open(CelltypeRef.create({ name: "tEmpty", cportTemplates: [], eportTemplates: [], attributeNames: [], hiddenRequirePortCount: 0 }), trigger);
    expect(dialog.querySelectorAll("section p")).toHaveLength(3);
    details.dispose();
    expect(dialog.open).toBe(false);
  });
});

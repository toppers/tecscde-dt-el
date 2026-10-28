/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

// 外部仕様6.5: 不正名・重複名の改名は拒否し、その理由を利用者へ伝える（#18）。
function setup() {
  const { document: model } = CdlDocumentLoader.loadSingle("cell tLogger c1 {}; cell tLogger c2 {};", "main.cde");
  const store = new AppStore(model);
  store.setSelection(SelectionState.ofCells([asCellId("c1")]));
  const root = document.createElement("div");
  const messages: string[] = [];
  new PropertyPanelView(root, store, (m) => messages.push(m)).render();
  const input = root.querySelector<HTMLInputElement>('input[aria-label="name"]')!;
  const rename = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("change"));
  };
  return { store, input, messages, rename };
}

describe("property panel cell rename feedback", () => {
  it("renames silently when the name is valid and free", () => {
    const { store, messages, rename } = setup();
    rename("c3");
    expect(store.getDocument().getCell(asCellId("c1"))?.name).toBe("c3");
    expect(messages).toEqual([]);
  });

  it("explains an invalid name and restores the field", () => {
    const { store, input, messages, rename } = setup();
    rename("1bad");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("1bad");
    expect(input.value).toBe("c1");
    expect(store.getDocument().getCell(asCellId("c1"))?.name).toBe("c1");
  });

  it("explains a duplicate name and restores the field", () => {
    const { store, input, messages, rename } = setup();
    rename("c2");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("既に使われています");
    expect(input.value).toBe("c1");
    expect(store.getDocument().getCell(asCellId("c1"))?.name).toBe("c1");
  });
});

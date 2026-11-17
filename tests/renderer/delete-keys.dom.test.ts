/** @vitest-environment happy-dom */
// 三者相違一覧 6-22（2026-11-17 決定、V0.2.6 段5）: Delete に加えて Backspace でも図の要素を削除する。
// 入力欄の編集中・IME 変換中の Delete／Backspace は、図の削除として扱わない（外部仕様6.3.2 差分、内部4F.1）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { SelectionState } from "../../src/renderer/render/view";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
let shell: AppShell | undefined;
afterEach(() => { shell?.dispose(); shell = undefined; document.head.replaceChildren(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount() {
  document.head.innerHTML = html.split("<head>")[1]!.split("</head>")[0]!;
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(CdlDocumentLoader.loadSingle("signature sMain { void f(void); };\ncelltype tMain { entry sMain e; };\ncell tMain Main {};\n", "main.cdl").document);
  shell = new AppShell({ root: document, store, win: window,
    gateway: { onRestoreFileBrowserRoot: vi.fn() } as unknown as FileGateway, tecsgen: {} as never, clipboard: {} as never });
  shell.start();
  store.setSelection(SelectionState.ofCells([asCellId("Main")]));
  return store;
}
const hasMain = (store: AppStore): boolean => store.getDocument().getCell(asCellId("Main")) !== undefined;
const press = (key: string, target: EventTarget, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
};

describe("Delete／Backspace による削除（6-22）", () => {
  it.each(["Delete", "Backspace"])("%s deletes the selected cell when no input has the focus", (key) => {
    const store = mount();
    press(key, document.body);
    expect(hasMain(store)).toBe(false);
  });

  it.each(["Delete", "Backspace"])("%s typed into an input field does not delete the diagram element", (key) => {
    const store = mount();
    press(key, document.querySelector("input")!);
    expect(hasMain(store)).toBe(true);
  });

  it.each(["Delete", "Backspace"])("%s during IME composition does not delete the diagram element", (key) => {
    const store = mount();
    press(key, document.body, { isComposing: true });
    expect(hasMain(store)).toBe(true);
  });
});

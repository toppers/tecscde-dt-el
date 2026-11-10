/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { MoveCellsCommand } from "../../src/renderer/commands/cell-commands";
import { asCellId } from "../../src/renderer/model/ids";
import { save, saveAs } from "../../src/renderer/app/file-actions";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

const source = "signature sMain { void f(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const makeDoc = () => CdlDocumentLoader.loadSingle(source, "/project/main.cdl").document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let shell: AppShell | undefined;
function mount() {
  const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(makeDoc());
  const gateway = {
    onRestoreFileBrowserRoot: vi.fn(), chooseFolder: vi.fn(async () => "/project"),
    listDirectory: vi.fn(async (path: string) => path === "/project" ? [
      { kind: "directory", path: "/project/sub", name: "sub" },
    ] : [{ kind: "file", path: "/project/sub/extra.cdl", name: "extra.cdl" }]),
    save: vi.fn(async (_path: string, _content: string) => {}), saveAs: vi.fn(async () => null),
    saveSession: vi.fn(async () => {}), resolveImports: vi.fn(async () => []),
  };
  shell = new AppShell({ root: document, store, gateway: gateway as unknown as FileGateway,
    tecsgen: {} as never, clipboard: { writeText: vi.fn(), readText: vi.fn() } as never, win: window });
  shell.start();
  return { shell, store, gateway };
}
function action(name: string) { document.querySelector<HTMLButtonElement>(`[data-action=${name}]`)!.click(); }
function close(id: string) { document.querySelector<HTMLButtonElement>(`#${id} [data-modeless-close]`)!.click(); }
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => { throw Error("unexpected modal"); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.open = false; this.dispatchEvent(new Event("close"));
  });
});
afterEach(() => { shell?.dispose(); shell = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("stage2 shell migration", () => {
  it("opens two reusable modeless views without invoking folder selection or changing the document", () => {
    const { store, gateway } = mount(); const documentBefore = store.getDocument(); const history = store.history;
    expect(document.querySelector("#display-bar")).toBeNull();
    for (const id of ["region-filter", "filter-color", "filter-signature", "filter-emphasize"]) {
      expect(document.querySelector(`#${id}`)!.closest("#toolbar")).not.toBeNull();
    }
    expect(document.querySelector("#main > #palette, #main > #file-browser")).toBeNull();
    action("openFileBrowser"); action("openCelltypes"); action("openFileBrowser");
    expect(document.querySelectorAll(".modeless-dialog[open]")).toHaveLength(2);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(gateway.chooseFolder).not.toHaveBeenCalled();
    close("file-browser-dialog"); action("openFileBrowser");
    expect(document.querySelectorAll(".modeless-dialog")).toHaveLength(2);
    expect(store.getDocument()).toBe(documentBefore); expect(store.history).toBe(history); expect(store.isDirty()).toBe(false);
  });
  it("keeps the browser tree expanded across repeated closing and reopening", async () => {
    const { gateway } = mount(); action("openFileBrowser"); action("chooseFolder"); await tick();
    document.querySelector<HTMLElement>('[data-path="/project/sub"]')!.click(); await tick();
    const browser = document.querySelector("#file-browser");
    close("file-browser-dialog"); action("openFileBrowser");
    expect(document.querySelector("#file-browser")).toBe(browser);
    expect(browser!.querySelector('[data-path="/project/sub/extra.cdl"]')).not.toBeNull();
    expect(gateway.listDirectory).toHaveBeenCalledTimes(2);
  });
  it("updates the existing celltype view while it is closed", () => {
    const { store } = mount(); action("openCelltypes");
    const palette = document.querySelector("#palette"); close("celltypes-dialog");
    const changed = CdlDocumentLoader.loadSingle(
      "signature sOther { void f(void); }; celltype tOther { entry sOther e; }; cell tOther Other {};", "/other.cdl").document;
    store.loadDocument(changed, "/other.cdl"); action("openCelltypes");
    expect(document.querySelector("#palette")).toBe(palette);
    expect(palette!.querySelector('[data-celltype="tOther"]')).not.toBeNull();
    expect(palette!.querySelector('[data-celltype="tMain"]')).toBeNull();
    expect(document.querySelectorAll("#celltypes-dialog")).toHaveLength(1);
  });
  it("allows cell placement and Undo while both dialogs remain open and keeps the active mode visible", () => {
    const { shell, store } = mount(); action("openFileBrowser"); action("openCelltypes");
    expect(document.querySelector("#status-mode")!.textContent).toBe("選択");
    document.querySelector<HTMLButtonElement>('[data-celltype="tMain"]')!.click();
    expect(document.querySelector("#status-mode")!.textContent).toBe("セル新規作成");
    expect(document.querySelector('[data-mode=newCell]')!.getAttribute("aria-pressed")).toBe("true");
    const count = store.getDocument().cellCount;
    shell.gesture.pointerDown({ x: 160, y: 100 }); shell.gesture.pointerUp({ x: 160, y: 100 });
    expect(store.getDocument().cellCount).toBe(count + 1); action("undo");
    expect(store.getDocument().cellCount).toBe(count);
    expect(document.querySelectorAll(".modeless-dialog[open]")).toHaveLength(2);
  });
  it("keeps filters and mode as view state while reflecting the same dirty value in title and status", () => {
    const { store } = mount(); store.loadDocument(makeDoc(), "/project/main.cdl");
    const documentBefore = store.getDocument(); const history = store.history; const selection = store.selection;
    const color = document.querySelector<HTMLInputElement>("#filter-color")!;
    color.checked = true; color.dispatchEvent(new Event("change"));
    store.setMode("newCell"); store.setEnvironmentDiagnostics([]);
    expect(store.view.filters.colorByRegion).toBe(true);
    expect(store.getDocument()).toBe(documentBefore); expect(store.history).toBe(history); expect(store.selection).toBe(selection);
    expect(document.title).toBe("main.cdl — TECSCDE");
    store.dispatch(new MoveCellsCommand([asCellId("Main")], 5, 0));
    expect(document.title).toBe("* main.cdl — TECSCDE");
    expect(document.querySelector("#status-file")!.classList.contains("dirty")).toBe(true);
    store.undo(); expect(document.title).toBe("main.cdl — TECSCDE");
    store.redo(); expect(document.title).toBe("* main.cdl — TECSCDE");
  });
  it("shows dirty state for an unnamed document and preserves it after save cancellation or failure", async () => {
    const { store, gateway } = mount();
    store.dispatch(new MoveCellsCommand([asCellId("Main")], 5, 0));
    expect(document.title).toBe("* (未保存) — TECSCDE");
    expect(document.querySelector("#status-file")!.classList.contains("dirty")).toBe(true);
    await saveAs(store, gateway as unknown as FileGateway);
    expect(document.title.startsWith("* ")).toBe(true);
    store.loadDocument(makeDoc(), "/project/main.cdl");
    store.dispatch(new MoveCellsCommand([asCellId("Main")], 5, 0));
    gateway.save.mockRejectedValueOnce(Error("write failed"));
    await expect(save(store, gateway as unknown as FileGateway)).rejects.toThrow("write failed");
    expect(document.title.startsWith("* ")).toBe(true);
    await save(store, gateway as unknown as FileGateway); expect(document.title).toBe("main.cdl — TECSCDE");
  });
  it("closes only the focused modeless dialog with Escape without clearing search", () => {
    const { store } = mount(); action("openFileBrowser"); action("openCelltypes");
    store.setView(store.view.withSearchQuery("Main"));
    const before = store.getDocument(); const history = store.history;
    document.querySelector("#celltypes-dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect((document.querySelector("#celltypes-dialog") as HTMLDialogElement).open).toBe(false);
    expect((document.querySelector("#file-browser-dialog") as HTMLDialogElement).open).toBe(true);
    expect(store.view.searchQuery).toBe("Main"); expect(store.getDocument()).toBe(before); expect(store.history).toBe(history);
  });
  it("focuses the canvas without browser default scrolling when returning from a modeless control", () => {
    mount(); action("openCelltypes");
    document.querySelector<HTMLButtonElement>("#celltypes-dialog [data-modeless-close]")!.focus();
    const svg = document.querySelector<SVGSVGElement>("#canvas")!;
    const down = new MouseEvent("mousedown", { button: 0, clientX: 200, clientY: 160, bubbles: true, cancelable: true });
    svg.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(svg);
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0, clientX: 200, clientY: 160 }));
  });
});

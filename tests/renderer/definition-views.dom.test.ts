/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { PaletteView } from "../../src/renderer/app/palette";
import { DefinitionFileView } from "../../src/renderer/app/definition-file-view";
import { CelltypeDetailsView } from "../../src/renderer/app/celltype-details-view";
import { definitionLocation } from "../../src/renderer/app/definition-source";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { Cell } from "../../src/renderer/model/cell";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";

const types = "signature s { void run(void); }; celltype tRef { entry s e; }; cell tRef Reference {};";
function model(source = "/定義/別ディレクトリ/definition.cdl") {
  return CdlDocumentLoader.loadSources([
    { text: types, fileName: "definition.cdl", sourcePath: source, editable: true },
    { text: "cell tRef Primary {};", fileName: "main.cdl", sourcePath: "/project/main.cdl", editable: true },
  ]).document;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("definition source metadata", () => {
  it("keeps the defining type's absolute source independently of its basename", () => {
    const doc = model();
    expect(doc.getCelltype("tRef")?.locale).toBe("definition.cdl");
    expect(doc.getCelltype("tRef")?.sourcePath).toBe("/定義/別ディレクトリ/definition.cdl");
    expect(doc.getCelltype("tRef")?.generated).toBe(false);
  });

  it("maps generated types to virtual source text and never exposes a temporary physical path", () => {
    const doc = CdlDocumentLoader.loadSources([
      { text: types, fileName: "plugin:generated.cdl", sourcePath: "/tmp/private/generated.cdl", editable: false, generated: true },
    ]).document;
    const type = doc.getCelltype("tRef")!;
    expect(type.generated).toBe(true);
    const location = definitionLocation(type.sourcePath ?? type.locale, [{ fileName: "generated.cdl", content: types }], type.generated);
    expect(location.label).toBe("plugin:generated.cdl");
    expect(location.source?.kind).toBe("virtual");
    expect(JSON.stringify(location)).not.toContain("/tmp/private");
  });
});

describe("single-cell definition footer", () => {
  it("shows the cell's defining full path at the bottom and viewing leaves document/history/dirty untouched", () => {
    const store = new AppStore(model());
    store.loadDocument(model(), "/other/current.cdl");
    store.setSelection(SelectionState.ofCells([asCellId("Reference")]));
    const root = document.createElement("div");
    const show = vi.fn();
    const panel = new PropertyPanelView(root, store, { onShowDefinition: show });
    const before = store.getDocument(); const history = store.history; const dirty = store.isDirty();
    panel.render();
    expect(root.lastElementChild?.classList.contains("definition-source")).toBe(true);
    expect(root.querySelector(".definition-path")!.textContent).toBe("/定義/別ディレクトリ/definition.cdl");
    root.querySelector<HTMLButtonElement>("[data-show-definition]")!.click();
    expect(show).toHaveBeenCalledExactlyOnceWith({ kind: "disk", path: "/定義/別ディレクトリ/definition.cdl" });
    expect(store.getDocument()).toBe(before); expect(store.history).toBe(history); expect(store.isDirty()).toBe(dirty);
  });

  it("updates for a changed source, hides for multiple selection, and does not infer a missing source from the primary", () => {
    const store = new AppStore(model()); const root = document.createElement("div");
    const panel = new PropertyPanelView(root, store, { onShowDefinition: vi.fn() });
    store.setSelection(SelectionState.ofCells([asCellId("Reference")])); panel.render();
    store.loadDocument(model("/new/同名/definition.cdl"), "/project/main.cdl");
    store.setSelection(SelectionState.ofCells([asCellId("Reference")])); panel.render();
    expect(root.querySelector(".definition-path")!.textContent).toBe("/new/同名/definition.cdl");
    store.setSelection(SelectionState.ofCells([asCellId("Reference"), asCellId("Primary")])); panel.render();
    expect(root.querySelector(".definition-source")).toBeNull();
    const cell = store.getDocument().getCell(asCellId("Reference"))!;
    store.loadDocument(store.getDocument().withCell(Cell.create({ ...cell, locale: undefined })), "/project/main.cdl");
    store.setSelection(SelectionState.ofCells([cell.id])); panel.render();
    expect(root.querySelector(".definition-path")!.textContent).toBe("パスなし");
    expect(root.querySelector<HTMLButtonElement>("[data-show-definition]")!.disabled).toBe(true);
  });
});

describe("DefinitionFileView", () => {
  it("reads only the requested disk file and displays literal text in a modeless readonly window", async () => {
    const readFile = vi.fn(async (path: string) => ({ path, content: '<img src=x onerror=alert(1)>\ncell tRef DiskVersion {};' }));
    const view = new DefinitionFileView({ readFile, document });
    await view.open({ kind: "disk", path: "/日本語/very long path/definition.cdl" }, "セル定義ファイルウィンドウ");
    expect(readFile).toHaveBeenCalledExactlyOnceWith("/日本語/very long path/definition.cdl");
    expect(HTMLDialogElement.prototype.show).toHaveBeenCalledOnce();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(document.querySelector(".definition-file-window pre")!.textContent).toContain("<img src=x");
    expect(document.querySelector(".definition-file-window img")).toBeNull();
    expect(document.querySelector(".definition-file-window [contenteditable=true]")).toBeNull();
    expect(document.querySelector(".definition-file-window")!.textContent).toContain("ディスク上の内容");
    const canvasShortcut = vi.fn();
    window.addEventListener("keydown", canvasShortcut);
    const key = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    document.querySelector(".definition-file-window pre")!.dispatchEvent(key);
    expect(canvasShortcut).not.toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(false);
    window.removeEventListener("keydown", canvasShortcut);
    view.dispose();
  });

  it("uses virtual text without disk reads and reports missing/read-denied files inside the window", async () => {
    const readFile = vi.fn(async (_path: string): Promise<{ path: string; content: string }> => { throw new Error("アクセス拒否"); });
    const view = new DefinitionFileView({ readFile, document });
    await view.open({ kind: "virtual", path: "plugin:generated.cdl", content: "virtual body" }, "セルタイプ定義ファイルウィンドウ");
    expect(readFile).not.toHaveBeenCalled();
    expect(document.querySelector(".definition-file-window pre")!.textContent).toBe("virtual body");
    expect(document.querySelector(".definition-file-window")!.textContent).toContain("仮想ソース");
    await view.open({ kind: "disk", path: "/missing.cdl" }, "セル定義ファイルウィンドウ");
    expect(document.querySelector(".definition-file-error")!.textContent).toContain("アクセス拒否");
    expect(document.querySelector(".definition-file-window pre")!.textContent).toBe("");
    view.dispose();
  });

  it("rejects reversed reads and late errors after another source opens or the view closes", async () => {
    const first = deferred<{ path: string; content: string }>();
    const readFile = vi.fn(async (path: string) => path === "/old" ? first.promise : { path, content: "new body" });
    const view = new DefinitionFileView({ readFile, document });
    const old = view.open({ kind: "disk", path: "/old" }, "セル定義ファイルウィンドウ");
    await view.open({ kind: "disk", path: "/new" }, "セル定義ファイルウィンドウ");
    first.reject(new Error("old failure")); await old;
    expect(document.querySelector(".definition-file-window pre")!.textContent).toBe("new body");
    expect(document.querySelector(".definition-file-error")!.textContent).not.toContain("old failure");
    const late = deferred<{ path: string; content: string }>(); readFile.mockReturnValue(late.promise);
    const pending = view.open({ kind: "disk", path: "/late" }, "セル定義ファイルウィンドウ");
    document.querySelector<HTMLButtonElement>(".definition-file-window [data-close-definition]")!.click();
    late.resolve({ path: "/late", content: "obsolete body" }); await pending;
    expect(view.isOpen).toBe(false);
    expect(document.querySelector(".definition-file-window pre")!.textContent).not.toBe("obsolete body");
    view.dispose();
  });
});

describe("celltype details and palette entry", () => {
  it("opens explicit details modally without choosing placement mode and retains basename/full-path fields", () => {
    const store = new AppStore(model()); store.setActiveCelltype("tRef");
    const showDefinition = vi.fn();
    const details = new CelltypeDetailsView({ store, onShowDefinition: showDefinition, document });
    const root = document.createElement("div");
    root.innerHTML = '<button data-mode="select"></button><button data-mode="newCell"></button><div id="palette-celltypes"></div>';
    const palette = new PaletteView(root, store, (name) => details.open(name)); palette.render();
    const before = store.getDocument(); const history = store.history;
    root.querySelector<HTMLButtonElement>('[data-celltype-details="tRef"]')!.click();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(store.getMode()).toBe("select");
    expect(document.querySelector(".celltype-details-dialog")!.textContent).toContain("definition.cdl");
    expect(document.querySelector(".celltype-details-dialog .definition-path")!.textContent).toBe("/定義/別ディレクトリ/definition.cdl");
    document.querySelector<HTMLButtonElement>(".celltype-details-dialog [data-show-definition]")!.click();
    expect(showDefinition).toHaveBeenCalledExactlyOnceWith({ kind: "disk", path: "/定義/別ディレクトリ/definition.cdl" });
    expect(details.isOpen).toBe(false);
    expect(store.getDocument()).toBe(before); expect(store.history).toBe(history); expect(store.isDirty()).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-celltype-details="tRef"]')!.click();
    expect(details.isOpen).toBe(true);
    expect(store.selection.cellIds.size).toBe(0);
    root.querySelector<HTMLButtonElement>('[data-celltype="tRef"]')!.click();
    expect(store.getMode()).toBe("newCell");
    palette.dispose(); details.dispose();
  });

  it("shows composite metadata and clears obsolete details when the type disappears", () => {
    const doc = CdlDocumentLoader.loadSources([{ text: "composite tComposite { entry s e; };", fileName: "composite.cdl", sourcePath: "/composite.cdl", editable: true }]).document;
    const store = new AppStore(doc);
    const details = new CelltypeDetailsView({ store, onShowDefinition: vi.fn(), document });
    details.open("tComposite");
    expect(document.querySelector(".celltype-details-dialog")!.textContent).toContain("複合セルタイプ");
    store.loadDocument(model(), "/main.cdl"); details.render();
    expect(document.querySelector(".celltype-details-dialog")!.textContent).toContain("見つかりません");
    expect(document.querySelector(".celltype-details-dialog .definition-path")).toBeNull();
    details.dispose();
  });

  it("does not show basename-only or generated temporary paths as real defining files", () => {
    const doc = CdlDocumentLoader.loadSources([{ text: "celltype tVirtual { entry s e; };", fileName: "plugin:generated.cdl", sourcePath: "/tmp/tecsgen/generated.cdl", generated: true, editable: false }]).document;
    const store = new AppStore(doc);
    const details = new CelltypeDetailsView({ store, onShowDefinition: vi.fn(), document });
    details.open("tVirtual");
    expect(document.querySelector(".celltype-details-dialog")!.textContent).not.toContain("/tmp/tecsgen");
    expect(document.querySelector<HTMLButtonElement>(".celltype-details-dialog [data-show-definition]")!.disabled).toBe(true);
    details.dispose();
  });

  it("can view a generated type's available virtual text without exposing a disk path", () => {
    const doc = CdlDocumentLoader.loadSources([{ text: types, fileName: "plugin:generated.cdl", sourcePath: "/tmp/generated.cdl", editable: false, generated: true }]).document;
    const show = vi.fn();
    const details = new CelltypeDetailsView({
      store: { getDocument: () => doc, getGeneratedTypeSources: () => [{ fileName: "generated.cdl", content: types }] },
      onShowDefinition: show, document,
    });
    details.open("tRef");
    expect(document.querySelector(".celltype-details-dialog .definition-path")!.textContent).toBe("plugin:generated.cdl");
    const button = document.querySelector<HTMLButtonElement>(".celltype-details-dialog [data-show-definition]")!;
    expect(button.disabled).toBe(false); button.click();
    expect(show).toHaveBeenCalledExactlyOnceWith({ kind: "virtual", path: "plugin:generated.cdl", content: types });
    expect(details.isOpen).toBe(false);
    details.dispose();
  });

  it("does not infer a basename-only celltype source from the current primary file", () => {
    const doc = CdlDocumentLoader.loadSingle(types, "definition.cdl").document;
    const store = new AppStore(doc); store.loadDocument(doc, "/other/primary.cdl");
    const details = new CelltypeDetailsView({ store, onShowDefinition: vi.fn(), document });
    details.open("tRef");
    expect(document.querySelector(".celltype-details-dialog .definition-path")!.textContent).toBe("パスなし");
    expect(document.querySelector<HTMLButtonElement>(".celltype-details-dialog [data-show-definition]")!.disabled).toBe(true);
    details.dispose();
  });
});

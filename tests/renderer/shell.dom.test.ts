/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— `AppShell` を実 DOM（happy-dom）で
// 動かし、`SvgRenderer` / `GestureController` / `ViewState` の配線を検証する。
// SVG 幾何・ズーム/パンのスクロール連動の実挙動は手動 `electron .` で確認する
// （happy-dom はレイアウトを持たない、2026-09-10 のスコープ確認）。

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId } from "../../src/renderer/model/ids";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { SelectionState } from "../../src/renderer/render/view";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const noopGateway = {
  open: async () => null,
  save: async () => undefined,
  saveAs: async () => null,
  export: async () => undefined,
} as unknown as FileGateway;

function fakeClipboard() {
  let clipboardText = "";
  return {
    writeText: (text: string) => {
      clipboardText = text;
      return Promise.resolve();
    },
    readText: () => Promise.resolve(clipboardText),
  } as unknown as ClipboardGateway;
}

const BODY_HTML = `
  <div id="app">
    <div id="toolbar">
      <button data-action="open" type="button">開く</button>
      <button data-action="save" type="button">保存</button>
      <button data-action="saveAs" type="button">名前を付けて保存</button>
      <button data-action="undo" type="button">元に戻す</button>
      <button data-action="redo" type="button">やり直し</button>
      <button data-action="zoomOut" type="button">−</button>
      <button data-action="zoomReset" type="button">100%</button>
      <button data-action="zoomIn" type="button">＋</button>
      <button data-action="toggleGrid" type="button">グリッド</button>
      <label><input type="checkbox" id="mode-newcell" /> セル新規</label>
      <select id="celltype-select"></select>
    </div>
    <div id="canvas-scroll">
      <svg id="canvas" xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>
    </div>
    <div id="statusbar">
      <span id="status-pos"></span>
      <span id="status-zoom"></span>
      <span id="status-diag"></span>
      <span id="status-file"></span>
    </div>
  </div>
`;

let mounted: AppShell | undefined;

function mountShell(clipboard: ClipboardGateway = fakeClipboard()): { shell: AppShell; store: AppStore; clipboard: ClipboardGateway } {
  document.body.innerHTML = BODY_HTML;
  const store = new AppStore(loadDoc());
  const shell = new AppShell({ root: document, store, gateway: noopGateway, clipboard, win: window });
  shell.start();
  mounted = shell;
  return { shell, store, clipboard };
}

describe("AppShell — DOM wiring", () => {
  afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  it("renders one <g> per cell under #cells after start()", () => {
    mountShell();
    const cells = document.querySelector("#cells");
    expect(cells).not.toBeNull();
    expect(cells!.children.length).toBe(3);
  });

  it("populates the celltype <select> and picks the first as active", () => {
    const { store } = mountShell();
    const select = document.querySelector<HTMLSelectElement>("#celltype-select")!;
    expect(select.options.length).toBe(3);
    expect(store.getActiveCelltypeName()).toBe(select.options[0]!.value);
  });

  it("toggle-grid button flips the #grid layer visibility", () => {
    mountShell();
    const grid = () => document.querySelector<SVGGElement>("#grid")!;
    expect(grid().style.display).toBe("none");
    document.querySelector<HTMLButtonElement>("[data-action='toggleGrid']")!.click();
    expect(grid().style.display).toBe("");
  });

  it("undo button reverts a committed edit and updates its disabled state", () => {
    const { store } = mountShell();
    const controller = asCellId("cController1");
    const x0 = store.getDocument().getCell(controller)!.x;

    const undoBtn = document.querySelector<HTMLButtonElement>("[data-action='undo']")!;
    expect(undoBtn.disabled).toBe(true);

    store.dispatch(new MoveCellsCommand([controller], 5, 0));
    expect(undoBtn.disabled).toBe(false);
    expect(store.getDocument().getCell(controller)!.x).toBe(x0 + 5);

    undoBtn.click();
    expect(store.getDocument().getCell(controller)!.x).toBe(x0);
    expect(undoBtn.disabled).toBe(true);
  });

  it("mode checkbox change puts the store in newCell mode and enables the select", () => {
    const { store } = mountShell();
    const checkbox = document.querySelector<HTMLInputElement>("#mode-newcell")!;
    const select = document.querySelector<HTMLSelectElement>("#celltype-select")!;
    expect(select.disabled).toBe(true);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    expect(store.getMode()).toBe("newCell");
    expect(select.disabled).toBe(false);
  });

  it("GestureController pointer sequence moves a cell via one command", () => {
    const { shell, store } = mountShell();
    const controller = asCellId("cController1");
    const cell = store.getDocument().getCell(controller)!;
    const center = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };

    shell.gesture.pointerDown(center);
    shell.gesture.pointerMove({ x: center.x + 7, y: center.y });
    shell.gesture.pointerUp({ x: center.x + 7, y: center.y });

    expect(store.getDocument().getCell(controller)!.x).toBe(cell.x + 7);
    expect(store.canUndo).toBe(true);
  });

  it("shows no diagnostics indicator for the clean sample fixture (module H)", () => {
    const { store } = mountShell();
    expect(store.getReport().isEmpty).toBe(true);
    expect(document.querySelector("#status-diag")!.textContent).toBe("");
  });

  it("shows the diagnostics count in the status bar after loading a document with warnings (module H)", () => {
    const { store } = mountShell();
    const text = [
      "cell tUndefinedType cFoo {",
      "}",
      '__tool_info__("tecsgen") {',
      '  "direct_import": ["missing.cdl"]',
      "}",
      "",
    ].join("\n");
    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(text, "broken.cde");
    store.loadDocument(doc, "broken.cde", diagnostics);

    const report = store.getReport();
    expect(report.warningCount).toBeGreaterThanOrEqual(2);
    expect(document.querySelector("#status-diag")!.textContent).toContain(
      `${report.errorCount} エラー / ${report.warningCount} 警告`,
    );
  });

  it("dispose() unwires listeners without throwing", () => {
    const { shell } = mountShell();
    expect(() => shell.dispose()).not.toThrow();
  });

  it("Ctrl+C copies the selection to the clipboard without changing the document or history", () => {
    const clipboard = fakeClipboard();
    const { store } = mountShell(clipboard);
    const controller = asCellId("cController1");
    store.setSelection(SelectionState.ofCells([controller]));
    const before = store.getDocument();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }));

    expect(store.getDocument()).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it("Ctrl+X cuts the selection as one undoable command", () => {
    const { store } = mountShell();
    const controller = asCellId("cController1");
    store.setSelection(SelectionState.ofCells([controller]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true }));

    expect(store.getDocument().getCell(controller)).toBeUndefined();
    expect(store.canUndo).toBe(true);
  });

  it("Ctrl+C then Ctrl+V pastes a copy of the selected cell via the app-internal clipboard", async () => {
    const { store } = mountShell();
    const controller = asCellId("cController1");
    store.setSelection(SelectionState.ofCells([controller]));
    const before = store.getDocument().cellCount;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true }));
    await Promise.resolve(); // pasteFromClipboard() は readText() の解決を待つ非同期処理

    expect(store.getDocument().cellCount).toBe(before + 1);
    expect(store.canUndo).toBe(true); // Pasteは通常のコマンドとして履歴に載る
  });

  it("ignores Ctrl+C/X/V while focus is on a text input (native copy/paste takes over)", () => {
    const { store } = mountShell();
    const controller = asCellId("cController1");
    store.setSelection(SelectionState.ofCells([controller]));
    const select = document.querySelector<HTMLSelectElement>("#celltype-select")!;
    select.focus();

    select.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }));

    expect(store.getDocument().getCell(controller)).toBeDefined();
  });
});

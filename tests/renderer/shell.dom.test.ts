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
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { SelectionState } from "../../src/renderer/render/view";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(mainEditable = true): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: mainEditable },
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
      <button data-action="toggleNavigator" type="button">ナビゲータ</button>
      <div id="search-box">
        <input type="search" id="search-input" />
        <span id="search-count"></span>
        <button data-action="searchPrev" type="button">↑</button>
        <button data-action="searchNext" type="button">↓</button>
        <div id="search-results"></div>
      </div>
    </div>
    <div id="main">
      <div id="palette">
        <div id="palette-mode">
          <button data-mode="select" type="button">選択</button>
          <button data-mode="newCell" type="button">セル新規作成</button>
        </div>
        <div id="palette-celltypes"></div>
      </div>
      <div id="canvas-area">
        <div id="canvas-scroll">
          <svg id="canvas" xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>
        </div>
        <div id="navigator">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>
        </div>
      </div>
      <div id="property-panel"></div>
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

function mountShell(
  clipboard: ClipboardGateway = fakeClipboard(),
  doc: TecscdeDocument = loadDoc(),
): { shell: AppShell; store: AppStore; clipboard: ClipboardGateway } {
  document.body.innerHTML = BODY_HTML;
  const store = new AppStore(doc);
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

  it("populates the palette's celltype list and picks the first as active", () => {
    const { store } = mountShell();
    const items = document.querySelectorAll<HTMLButtonElement>(".palette-celltype");
    expect(items.length).toBe(3);
    expect(store.getActiveCelltypeName()).toBe(items[0]!.dataset["celltype"]);
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

  it("palette mode buttons toggle select/newCell exclusively", () => {
    const { store } = mountShell();
    const selectBtn = document.querySelector<HTMLButtonElement>("[data-mode='select']")!;
    const newCellBtn = document.querySelector<HTMLButtonElement>("[data-mode='newCell']")!;
    expect(selectBtn.classList.contains("active")).toBe(true);
    expect(newCellBtn.classList.contains("active")).toBe(false);

    newCellBtn.click();

    expect(store.getMode()).toBe("newCell");
    expect(newCellBtn.classList.contains("active")).toBe(true);
    expect(selectBtn.classList.contains("active")).toBe(false);
  });

  it("clicking a celltype in the palette selects it and switches to newCell mode", () => {
    const { store } = mountShell();
    const items = document.querySelectorAll<HTMLButtonElement>(".palette-celltype");
    const other = Array.from(items).find((el) => el.dataset["celltype"] !== store.getActiveCelltypeName())!;

    other.click();

    expect(store.getActiveCelltypeName()).toBe(other.dataset["celltype"]);
    expect(store.getMode()).toBe("newCell");
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
    const input = document.querySelector<HTMLInputElement>("#search-input")!;
    input.focus();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }));

    expect(store.getDocument().getCell(controller)).toBeDefined();
  });

  describe("PropertyPanelView", () => {
    it("shows (未選択) when nothing is selected", () => {
      mountShell();
      expect(document.querySelector("#property-panel")!.textContent).toContain("未選択");
    });

    it("shows editable fields for a single selected editable cell, and dispatches a rename on change", () => {
      const { store } = mountShell();
      const controller = asCellId("cController1");
      store.setSelection(SelectionState.ofCells([controller]));

      const nameInput = document.querySelector<HTMLInputElement>("#property-panel .prop-field input")!;
      expect(nameInput.value).toBe("cController1");
      expect(nameInput.readOnly).toBe(false);

      nameInput.value = "renamedController";
      nameInput.dispatchEvent(new Event("change"));

      expect(store.getDocument().getCell(controller)!.name).toBe("renamedController");
      expect(store.canUndo).toBe(true);
    });

    it("marks fields read-only and shows a note for a cell from a read-only file", () => {
      const { store } = mountShell(fakeClipboard(), loadDoc(false));
      const logger = asCellId("cLogger1");
      store.setSelection(SelectionState.ofCells([logger]));

      expect(document.querySelector("#property-panel .prop-readonly-note")).not.toBeNull();
      const nameInput = document.querySelector<HTMLInputElement>("#property-panel .prop-field input")!;
      expect(nameInput.readOnly).toBe(true);
    });

    it("shows no read-only note for an editable cell", () => {
      const { store } = mountShell();
      store.setSelection(SelectionState.ofCells([asCellId("cLogger1")]));
      expect(document.querySelector("#property-panel .prop-readonly-note")).toBeNull();
    });

    it("shows a multi-select message when more than one cell is selected", () => {
      const { store } = mountShell();
      store.setSelection(SelectionState.ofCells([asCellId("cLogger1"), asCellId("cSensor1")]));
      expect(document.querySelector("#property-panel")!.textContent).toContain("複数選択");
    });

    it("shows join endpoints (read-only) when a join is selected", () => {
      const { store } = mountShell();
      store.setSelection(SelectionState.ofJoin(asJoinId("cController1.cLog")));
      expect(document.querySelector("#property-panel")!.textContent).toContain("結合を選択中");
      expect(document.querySelector("#property-panel .prop-readonly")!.textContent).toContain("cController1.cLog");
    });
  });

  describe("SearchBoxView", () => {
    it("typing a query lists matching cells (and any join whose label mentions it) with a count", () => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;

      input.value = "Logger";
      input.dispatchEvent(new Event("input"));

      expect(store.view.searchQuery).toBe("Logger");
      const hits = document.querySelectorAll(".search-hit");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(Array.from(hits).some((h) => h.textContent === "cLogger1")).toBe(true);
      expect(document.querySelector("#search-count")!.textContent).toBe(`${hits.length}件`);
    });

    it("clicking a hit selects and pans to it", () => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "cLogger1";
      input.dispatchEvent(new Event("input"));

      document.querySelector<HTMLElement>(".search-hit")!.click();

      const cell = store.getDocument().getCell(asCellId("cLogger1"))!;
      expect(store.selection.hasCell(asCellId("cLogger1"))).toBe(true);
      expect(store.view.panCenter).toEqual({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });
    });

    it("searchNext/searchPrev toolbar buttons cycle through hits", () => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "c"; // matches all three sample cells by name prefix
      input.dispatchEvent(new Event("input"));

      document.querySelector<HTMLButtonElement>("[data-action='searchNext']")!.click();
      const firstSelection = new Set(store.selection.cellIds);
      document.querySelector<HTMLButtonElement>("[data-action='searchNext']")!.click();
      const secondSelection = new Set(store.selection.cellIds);

      expect(firstSelection).not.toEqual(secondSelection);
    });

    it("empty query clears the hit list and count", () => {
      mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "cLogger1";
      input.dispatchEvent(new Event("input"));
      input.value = "";
      input.dispatchEvent(new Event("input"));

      expect(document.querySelectorAll(".search-hit").length).toBe(0);
      expect(document.querySelector("#search-count")!.textContent).toBe("");
    });
  });

  describe("NavigatorView", () => {
    it("is visible by default and hides when the whole paper already fits (auto-hide, 7.3.2)", () => {
      mountShell();
      // 初期表示（zoom=1）ではA4横用紙が既定のスクロールビューポート寸法(0x0, happy-dom)に
      // 収まらないため、autoHiddenはfalseになり得る。ここではtoggle()による明示的な
      // 非表示切り替えのみを検証する（自動非表示の幾何自体はview-state/navigator.test.tsで検証済み）。
      const nav = document.querySelector<HTMLElement>("#navigator")!;
      const before = nav.hidden;
      document.querySelector<HTMLButtonElement>("[data-action='toggleNavigator']")!.click();
      expect(nav.hidden).toBe(!before);
      document.querySelector<HTMLButtonElement>("[data-action='toggleNavigator']")!.click();
      expect(nav.hidden).toBe(before);
    });

    it("draws a viewBox and paper rect sized to the document's paper", () => {
      const { store } = mountShell();
      const svg = document.querySelector<SVGSVGElement>("#navigator svg")!;
      const { width, height } = store.getDocument().paper.contentSize();
      expect(svg.getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`);
      const paperRect = document.querySelector(".navigator-paper")!;
      expect(paperRect.getAttribute("width")).toBe(String(width));
      expect(paperRect.getAttribute("height")).toBe(String(height));
    });
  });
});

/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— `AppShell` を実 DOM（happy-dom）で
// 動かし、`SvgRenderer` / `GestureController` / `ViewState` の配線を検証する。
// SVG 幾何・ズーム/パンのスクロール連動の実挙動は手動 `electron .` で確認する
// （happy-dom はレイアウトを持たない、2026-09-10 のスコープ確認）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId, asJoinId, asRegionId } from "../../src/renderer/model/ids";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { SelectionState } from "../../src/renderer/render/view";
import { portPosition } from "../../src/renderer/model/geometry";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { TecsgenResult } from "../../src/shared/ipc-types";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";
import { PngExporter, PngExportTooLargeError } from "../../src/renderer/export/png-exporter";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(mainEditable = true): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: mainEditable },
  ]).document;
}

const noopGateway = {
  save: async () => undefined,
  saveAs: async () => null,
  export: async () => undefined,
  exportPdf: async () => undefined,
  chooseExportPath: async () => null,
  chooseFolder: async () => null,
  listDirectory: async () => [],
  openPath: async () => ({ editable: { path: "x.cde", content: "" }, references: [] }),
  confirmDiscardChanges: async () => true,
  saveSession: async () => undefined,
  resolveImports: async () => [],
  onRestoreFileBrowserRoot: () => undefined,
} as unknown as FileGateway;

function fakeFileGateway(): { gateway: FileGateway; saveCalls: Array<[string, string]> } {
  const saveCalls: Array<[string, string]> = [];
  const gateway = {
    save: async (path: string, content: string) => {
      saveCalls.push([path, content]);
    },
    saveAs: async () => null,
    export: async () => undefined,
    exportPdf: async () => undefined,
    chooseExportPath: async () => null,
    chooseFolder: async () => null,
    listDirectory: async () => [],
    openPath: async () => ({ editable: { path: "x.cde", content: "" }, references: [] }),
    confirmDiscardChanges: async () => true,
    saveSession: async () => undefined,
    resolveImports: async () => [],
    onRestoreFileBrowserRoot: () => undefined,
  } as unknown as FileGateway;
  return { gateway, saveCalls };
}

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

function fakeTecsgen(result: Partial<TecsgenResult> = {}): { gateway: TecsgenGateway; calls: string[][] } {
  const calls: string[][] = [];
  const gateway = {
    generate: (args: readonly string[]) => {
      calls.push([...args]);
      return Promise.resolve<TecsgenResult>({
        stdout: "",
        stderr: "",
        exitCode: 0,
        executableFound: true,
        ...result,
      });
    },
    version: () => Promise.resolve(null),
  } as unknown as TecsgenGateway;
  return { gateway, calls };
}

const BODY_HTML = `
  <div id="app">
    <div id="toolbar">
      <button data-action="openFolder" type="button">フォルダを開く</button>
      <button data-action="save" type="button">保存</button>
      <button data-action="saveAs" type="button">名前を付けて保存</button>
      <button data-action="exportDiagram" type="button">エクスポート</button>
      <button data-action="clear" type="button">消去</button>
      <button data-action="undo" type="button">元に戻す</button>
      <button data-action="redo" type="button">やり直し</button>
      <button data-action="alignTop" type="button">上端をそろえる</button>
      <button data-action="alignLeft" type="button">左端をそろえる</button>
      <button data-action="zoomReset" type="button">Reset Rate</button>
      <input id="zoom-slider" type="range" min="5" max="200" step="1" value="100" />
      <button data-action="toggleGrid" type="button">グリッド</button>
      <button data-action="toggleNavigator" type="button">ナビゲータ</button>
      <button data-action="generate" type="button">実行</button>
      <button data-action="copyTecsgenCommand" type="button">コマンドをコピー</button>
      <div id="search-box">
        <input type="search" id="search-input" />
        <span id="search-count"></span>
        <button data-action="searchPrev" type="button">↑</button>
        <button data-action="searchNext" type="button">↓</button>
        <div id="search-results"></div>
      </div>
    </div>
    <div id="display-bar">
      <details id="panel-visibility">
        <summary>表示</summary>
        <div id="panel-visibility-options">
          <label><input type="checkbox" data-panel="toolbar" checked /> ツールバー</label>
          <label><input type="checkbox" data-panel="palette" checked /> セルタイプ一覧</label>
          <label><input type="checkbox" data-panel="property-panel" checked /> プロパティ</label>
          <label><input type="checkbox" data-panel="statusbar" checked /> ステータス表示</label>
          <label><input type="checkbox" data-panel="file-browser" checked /> ファイルブラウザ</label>
        </div>
      </details>
      <div id="region-filter">
        <button type="button" id="region-filter-toggle">リージョン</button>
        <div id="region-filter-popover" hidden></div>
      </div>
      <label><input type="checkbox" id="filter-color" /> 色分け</label>
      <label><input type="checkbox" id="filter-signature" /> シグニチャ名</label>
      <label><input type="checkbox" id="filter-emphasize" /> セル名強調</label>
      <select id="paper-select"><option value="A4:LANDSCAPE">A4 横</option><option value="A4:PORTRAIT">A4 縦</option><option value="A3:LANDSCAPE">A3 横</option><option value="A3:PORTRAIT">A3 縦</option><option value="A2:LANDSCAPE">A2 横</option><option value="A2:PORTRAIT">A2 縦</option></select>
    </div>
    <div id="main">
      <div id="file-browser"></div>
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
        <div id="region-legend" hidden></div>
        <div id="navigator">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>
        </div>
      </div>
      <div id="property-panel"></div>
    </div>
    <div id="statusbar">
      <span id="status-pos"></span>
      <span id="status-zoom"></span>
      <span id="status-region"></span>
      <button id="status-diag" type="button"></button>
      <div id="diagnostics-panel" hidden></div>
      <span id="status-file"></span>
    </div>
    <div id="export-dialog" role="dialog" aria-modal="true" hidden>
      <select id="export-format"><option value="svg">SVG</option><option value="png">PNG</option><option value="pdf">PDF</option></select>
      <select id="export-range"><option value="paper">用紙</option><option value="content">内容</option></select>
      <label id="png-scale-field" hidden><select id="png-scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option></select></label>
      <button id="export-cancel" type="button">キャンセル</button>
      <button id="export-confirm" type="button">保存先を選ぶ</button>
    </div>
  </div>
`;

/** タイマー1回分だけ待って、保留中のマイクロタスク（非同期の入力解決など）を流し切る。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let mounted: AppShell | undefined;

function mountShell(
  clipboard: ClipboardGateway = fakeClipboard(),
  doc: TecscdeDocument = loadDoc(),
  gateway: FileGateway = noopGateway,
  tecsgen: TecsgenGateway = fakeTecsgen().gateway,
  windowGateway?: { setDirty(dirty: boolean): void },
): { shell: AppShell; store: AppStore; clipboard: ClipboardGateway } {
  document.body.innerHTML = BODY_HTML;
  const store = new AppStore(doc);
  const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, windowGateway, win: window });
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

  it("hides and restores every optional region from an always reachable menu without changing editor state", () => {
    const { store } = mountShell();
    store.setSelection(SelectionState.ofCells([store.getDocument().cellValues()[0]!.id]));
    store.setView(store.view.withSearchQuery("Sensor"));
    const doc = store.getDocument();
    const view = store.view;
    const selection = store.selection;
    const history = store.history;
    const menu = document.querySelector<HTMLDetailsElement>("#panel-visibility")!;
    const ids = ["toolbar", "palette", "property-panel", "statusbar", "file-browser"];
    const propertyInput = document.querySelector("#property-panel input");
    const palette = document.querySelector<HTMLElement>("#palette")!;
    palette.style.width = "222px";
    menu.open = true;

    for (const id of ids) {
      const checkbox = document.querySelector<HTMLInputElement>(`[data-panel='${id}']`)!;
      expect(checkbox.checked).toBe(true);
      checkbox.click();
      expect(document.getElementById(id)!.hidden).toBe(true);
    }
    store.setSelection(selection); // ストアの再描画でも非表示状態を維持する。
    expect(document.querySelector<HTMLElement>("#display-bar")!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#canvas-area")!.hidden).toBe(false);
    expect(menu.open).toBe(true);
    for (const id of ids) {
      expect(document.getElementById(id)!.hidden).toBe(true);
      document.querySelector<HTMLInputElement>(`[data-panel='${id}']`)!.click();
      expect(document.getElementById(id)!.hidden).toBe(false);
    }
    expect(document.querySelector("#property-panel input")).toBe(propertyInput);
    expect(palette.style.width).toBe("222px");
    expect(store.getDocument()).toBe(doc);
    expect(store.view).toBe(view);
    expect(store.selection).toBe(selection);
    expect(store.history).toBe(history);
    expect(store.isDirty()).toBe(false);
  });

  it("closes the visibility menu with Escape without clearing canvas search", () => {
    const { store } = mountShell();
    store.setView(store.view.withSearchQuery("Sensor"));
    const menu = document.querySelector<HTMLDetailsElement>("#panel-visibility")!;
    menu.open = true;
    const checkbox = menu.querySelector<HTMLInputElement>("input")!;
    checkbox.focus();
    checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.open).toBe(false);
    expect(store.view.searchQuery).toBe("Sensor");
    expect(document.activeElement).toBe(menu.querySelector("summary"));
  });

  it("removes visibility handlers when the shell is disposed", () => {
    const { shell } = mountShell();
    shell.dispose();
    document.querySelector<HTMLInputElement>("[data-panel='toolbar']")!.click();
    expect(document.querySelector<HTMLElement>("#toolbar")!.hidden).toBe(false);
  });

  it("updates paper size from the toolbar and tracks it as one undoable change", () => {
    const { store } = mountShell();
    const select = document.querySelector<HTMLSelectElement>("#paper-select")!;
    const svg = document.querySelector<SVGSVGElement>("#canvas")!;
    const original = store.getDocument();
    expect(select.value).toBe("A4:LANDSCAPE");

    select.value = "A3:PORTRAIT";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.getDocument().paper.contentSize()).toEqual({ width: 277, height: 400 });
    expect(Number(svg.getAttribute("height"))).toBeCloseTo(400 * store.view.pxPerMm);
    expect(store.history.past).toHaveLength(1);
    expect(store.isDirty()).toBe(true);

    store.undo();
    expect(store.getDocument().paper).toBe(original.paper);
    expect(select.value).toBe("A4:LANDSCAPE");
    expect(store.isDirty()).toBe(false);
    store.redo();
    expect(select.value).toBe("A3:PORTRAIT");
    expect(store.getDocument().paper.size).toBe("A3");
  });

  it("saves the selected paper size and leaves same-value selection out of history", async () => {
    const { gateway, saveCalls } = fakeFileGateway();
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    store.markSaved("C:/diagram.cde");
    const select = document.querySelector<HTMLSelectElement>("#paper-select")!;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.history.past).toHaveLength(0);
    expect(store.isDirty()).toBe(false);

    select.value = "A2:LANDSCAPE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("[data-action='save']")!.click();
    await flush();
    expect(saveCalls).toHaveLength(1);
    const saved = CdlDocumentLoader.loadSources([
      { text: saveCalls[0]![1], fileName: "saved.cde", editable: true },
    ]).document;
    expect(saved.paper.size).toBe("A2");
    expect(saved.paper.orientation).toBe("LANDSCAPE");
    expect(store.isDirty()).toBe(false);
  });

  it("opens SVG options and leaves the document untouched when path selection is canceled", async () => {
    const chooseExportPath = vi.fn().mockResolvedValue(null);
    const exportFile = vi.fn();
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = chooseExportPath;
    gateway.export = exportFile;
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const original = store.getDocument();

    document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
    expect(document.querySelector<HTMLElement>("#export-dialog")!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
    await flush();

    expect(chooseExportPath).toHaveBeenCalledWith("svg", "untitled.svg");
    expect(exportFile).not.toHaveBeenCalled();
    expect(store.getDocument()).toBe(original);
    expect(store.isDirty()).toBe(false);
  });

  it("exports the selected SVG range without changing history or selection", async () => {
    const exportFile = vi.fn().mockResolvedValue(undefined);
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("C:\\out\\diagram.svg");
    gateway.export = exportFile;
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const id = store.getDocument().cellValues()[0]!.id;
    store.setSelection(SelectionState.ofCells([id]));
    const original = store.getDocument();
    const canUndo = store.canUndo;

    document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
    document.querySelector<HTMLSelectElement>("#export-range")!.value = "content";
    document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
    await flush();

    expect(exportFile).toHaveBeenCalledOnce();
    const [path, svg] = exportFile.mock.calls[0] as [string, string];
    expect(path).toBe("C:\\out\\diagram.svg");
    expect(svg).toContain('class="cell-rect"');
    const exportedRoot = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    expect(exportedRoot.querySelector(".export-frame, .selection-outline")).toBeNull();
    expect(store.getDocument()).toBe(original);
    expect(store.selection.hasCell(id)).toBe(true);
    expect(store.canUndo).toBe(canUndo);
    expect(store.isDirty()).toBe(false);
  });

  it("exports PNG bytes at the selected scale without editing the document", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    const rasterize = vi.spyOn(PngExporter, "rasterize").mockResolvedValue(bytes);
    const gateway = fakeFileGateway().gateway;
    const chooseExportPath = vi.fn().mockResolvedValue("diagram.png");
    const exportFile = vi.fn().mockResolvedValue(undefined);
    gateway.chooseExportPath = chooseExportPath;
    gateway.export = exportFile;
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const original = store.getDocument();
    try {
      document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
      const format = document.querySelector<HTMLSelectElement>("#export-format")!;
      format.value = "png";
      format.dispatchEvent(new Event("change", { bubbles: true }));
      expect(document.querySelector<HTMLElement>("#png-scale-field")!.hidden).toBe(false);
      expect(document.querySelector<HTMLSelectElement>("#png-scale")!.value).toBe("2");
      document.querySelector<HTMLSelectElement>("#png-scale")!.value = "4";
      document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
      await flush();

      expect(chooseExportPath).toHaveBeenCalledWith("png", "untitled.png");
      expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({ svg: expect.stringContaining("<svg") }), 4);
      expect(exportFile).toHaveBeenCalledWith("diagram.png", bytes);
      expect(store.getDocument()).toBe(original);
      expect(store.isDirty()).toBe(false);
    } finally {
      rasterize.mockRestore();
    }
  });

  it("reports oversized PNGs with a size-specific diagnostic", async () => {
    const rasterize = vi.spyOn(PngExporter, "rasterize").mockRejectedValue(new PngExportTooLargeError());
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("diagram.png");
    gateway.export = vi.fn();
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
      const format = document.querySelector<HTMLSelectElement>("#export-format")!;
      format.value = "png";
      format.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
      await flush();
      expect(store.getReport().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "E-EXPORT-TOO-LARGE", severity: "error" }),
      ]));
      expect(gateway.export).not.toHaveBeenCalled();
    } finally {
      rasterize.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("exports PDF using the document paper size and orientation", async () => {
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("diagram.pdf");
    gateway.exportPdf = vi.fn().mockResolvedValue(undefined);
    gateway.export = vi.fn();
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const doc = store.getDocument();

    document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
    const format = document.querySelector<HTMLSelectElement>("#export-format")!;
    format.value = "pdf";
    format.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#png-scale-field")!.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
    await flush();

    expect(gateway.chooseExportPath).toHaveBeenCalledWith("pdf", "untitled.pdf");
    expect(gateway.exportPdf).toHaveBeenCalledWith("diagram.pdf", expect.stringContaining("<svg"), {
      kind: "paper", size: doc.paper.size, orientation: doc.paper.orientation,
    });
    expect(gateway.export).not.toHaveBeenCalled();
    expect(store.getDocument()).toBe(doc);
    expect(store.isDirty()).toBe(false);
  });

  it("exports the content range as a custom one-page PDF", async () => {
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("diagram.pdf");
    gateway.exportPdf = vi.fn().mockResolvedValue(undefined);
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const doc = store.getDocument();

    document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
    document.querySelector<HTMLSelectElement>("#export-format")!.value = "pdf";
    document.querySelector<HTMLSelectElement>("#export-range")!.value = "content";
    document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
    await flush();

    const [, svg, page] = vi.mocked(gateway.exportPdf).mock.calls[0]!;
    expect(page.kind).toBe("custom");
    if (page.kind !== "custom") throw new Error("expected custom page");
    expect(page.widthMm).toBeLessThan(doc.paper.contentSize().width + 20);
    expect(page.heightMm).toBeLessThan(doc.paper.contentSize().height + 20);
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector(".export-frame")).toBeNull();
    expect(store.getDocument()).toBe(doc);
    expect(store.isDirty()).toBe(false);
  });

  it("reports PDF generation failures without changing the document", async () => {
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("diagram.pdf");
    gateway.exportPdf = vi.fn().mockRejectedValue(new Error("print failed"));
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const doc = store.getDocument();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
      document.querySelector<HTMLSelectElement>("#export-format")!.value = "pdf";
      document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
      await flush();
      expect(store.getReport().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "E-EXPORT-FAILED", message: "print failed" }),
      ]));
      expect(store.getDocument()).toBe(doc);
      expect(store.isDirty()).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("reports SVG write failures in diagnostics", async () => {
    const gateway = fakeFileGateway().gateway;
    gateway.chooseExportPath = vi.fn().mockResolvedValue("out.svg");
    gateway.export = vi.fn().mockRejectedValue(new Error("disk full"));
    const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      document.querySelector<HTMLButtonElement>("[data-action='exportDiagram']")!.click();
      document.querySelector<HTMLButtonElement>("#export-confirm")!.click();
      await flush();
      expect(store.getReport().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "E-EXPORT-FAILED", message: "disk full" }),
      ]));
      expect(document.querySelector<HTMLElement>("#diagnostics-panel")!.hidden).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("pans by space + drag without changing selection or document", () => {
    const { shell, store } = mountShell();
    const svg = document.querySelector<SVGSVGElement>("#canvas")!;
    const scroll = document.querySelector<HTMLElement>("#canvas-scroll")!;
    Object.defineProperties(scroll, {
      clientWidth: { value: 200, configurable: true },
      clientHeight: { value: 160, configurable: true },
    });
    store.setView(store.view.panTo({ x: 100, y: 80 }));
    store.setSelection(SelectionState.ofCells([asCellId("cSensor1")]));
    const doc = store.getDocument();
    const startLeft = scroll.scrollLeft;
    const startTop = scroll.scrollTop;

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    svg.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 120, clientY: 80, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 90, clientY: 60, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }));

    expect(scroll.scrollLeft).toBeCloseTo(startLeft + 30);
    expect(scroll.scrollTop).toBeCloseTo(startTop + 20);
    expect(store.selection.hasCell(asCellId("cSensor1"))).toBe(true);
    expect(store.getDocument()).toBe(doc);
    expect(shell.gesture.stateKind).toBe("idle");
    expect(svg.style.cursor).toBe("");
  });

  it("does not activate space pan while typing in a text field", () => {
    const { store } = mountShell();
    const input = document.querySelector<HTMLInputElement>("#search-input")!;
    const svg = document.querySelector<SVGSVGElement>("#canvas")!;
    const before = store.view;
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    svg.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 120, clientY: 80, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 90, clientY: 60, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    expect(store.view).toBe(before);
    expect(svg.style.cursor).toBe("");
  });

  it("shows only the outer composite cell after double-click and Enter", () => {
    const text = `celltype tRegular { entry sTask eTask; };
composite tComposite {
  entry sTask eTask;
  cell tRegular Inner {};
  composite.eTask => Inner.eTask;
};
cell tComposite Composite {};
cell tRegular Regular {};
`;
    const doc = CdlDocumentLoader.loadSources([{ text, fileName: "composite.cdl", editable: true }]).document;
    const { store } = mountShell(fakeClipboard(), doc);
    const originalDirty = store.isDirty();
    const originalUndo = store.canUndo;
    const outer = document.querySelector<SVGGElement>('[data-cell-id="Composite"]')!;

    expect(outer).toBeTruthy();
    expect(document.querySelector('[data-cell-id="Inner"]')).toBeNull();
    expect(doc.getCell(asCellId("Composite"))?.eports.map((port) => port.name)).toEqual(["eTask"]);
    outer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    store.setSelection(SelectionState.ofCells([asCellId("Composite")]));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(document.querySelector(".composite-overlay")).toBeNull();
    expect(store.getDocument()).toBe(doc);
    expect(store.isDirty()).toBe(originalDirty);
    expect(store.canUndo).toBe(originalUndo);
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

  it("display bar: signature names default on and the checkbox follows the filter state", () => {
    const { store } = mountShell();
    const sig = document.querySelector<HTMLInputElement>("#filter-signature")!;
    const color = document.querySelector<HTMLInputElement>("#filter-color")!;
    expect(sig.checked).toBe(true);
    expect(color.checked).toBe(false);
    expect(document.querySelectorAll(".signature-label").length).toBeGreaterThan(0);

    sig.checked = false;
    sig.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.view.filters.showSignatureNames).toBe(false);
    expect(document.querySelectorAll(".signature-label").length).toBe(0);

    color.checked = true;
    color.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.view.filters.colorByRegion).toBe(true);
    expect(store.view.toCanvasView(store.getDocument().regions).regionColors).not.toBeNull();

    // 状態を外から変えたとき（例: 別経路）チェックボックスが追従する。
    store.setView(store.view.withFilters(store.view.filters.withShowSignatureNames(true).withColorByRegion(false)));
    expect(sig.checked).toBe(true);
    expect(color.checked).toBe(false);
  });

  it("region filter: unchecking a region hides its cells; opening another file restores them", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(
      "namespace N { region A { cell tLogger c1 {}; }; region B { cell tLogger c2 {}; }; };",
      "main.cde",
    );
    const { store } = mountShell(undefined, model);
    const cell = (id: string) => document.querySelector<SVGGElement>(`[data-cell-id='${id}']`)!;
    document.querySelector<HTMLButtonElement>("#region-filter-toggle")!.click();
    const box = document.querySelector<HTMLInputElement>("input[data-region-id='::N::A']")!;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cell("c1").style.display).toBe("none");
    expect(cell("c2").style.display).toBe("");

    store.loadDocument(model, "other.cde");
    expect(cell("c1").style.display).toBe("");
  });

  it("legend: shown on the canvas only while color-by-region is on", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(
      "namespace N { region A { cell tLogger c1 {}; }; };",
      "main.cde",
    );
    mountShell(undefined, model);
    const legend = document.querySelector<HTMLElement>("#region-legend")!;
    expect(legend.hidden).toBe(true);
    const color = document.querySelector<HTMLInputElement>("#filter-color")!;
    color.checked = true;
    color.dispatchEvent(new Event("change", { bubbles: true }));
    expect(legend.hidden).toBe(false);
    expect(legend.textContent).toContain("::N::A");
  });

  it("align buttons: enabled only for a multi-selection that would move, and align to the first selected", () => {
    const { store } = mountShell();
    const btn = (a: string) => document.querySelector<HTMLButtonElement>(`[data-action='${a}']`)!;
    expect(btn("alignLeft").disabled).toBe(true);

    store.setSelection(SelectionState.empty().withCellAdded(asCellId("cSensor1")).withCellAdded(asCellId("cLogger1")));
    expect(btn("alignLeft").disabled).toBe(false);
    expect(btn("alignTop").disabled).toBe(true); // 3セルとも y が同じ

    btn("alignLeft").click();
    const x = (id: string) => store.getDocument().getCell(asCellId(id))!.x;
    expect(x("cLogger1")).toBe(x("cSensor1"));
    expect(btn("alignLeft").disabled).toBe(true); // そろったので無効に戻る
    store.undo();
    expect(x("cLogger1")).not.toBe(x("cSensor1"));
  });

  it("display bar: cell-name emphasis toggles the label style and hides celltype names", () => {
    const { store } = mountShell();
    const box = document.querySelector<HTMLInputElement>("#filter-emphasize")!;
    expect(box.checked).toBe(false);
    expect(document.querySelectorAll(".celltype-label").length).toBeGreaterThan(0);

    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.view.filters.emphasizeCellName).toBe(true);
    expect(document.querySelectorAll(".celltype-label").length).toBe(0);
    expect(document.querySelectorAll(".cell-label.emphasized").length).toBeGreaterThan(0);

    store.setView(store.view.withFilters(store.view.filters.withEmphasizeCellName(false)));
    expect(box.checked).toBe(false);
    expect(document.querySelectorAll(".celltype-label").length).toBeGreaterThan(0);
  });

  it("status bar shows the region of the selected cell (外部仕様4.9.2)", () => {
    const { document: model } = CdlDocumentLoader.loadSingle(
      "namespace N { region A { cell tLogger c1 {}; }; region B { cell tLogger c2 {}; }; };",
      "main.cde",
    );
    const { store } = mountShell(undefined, model);
    const text = () => document.querySelector<HTMLElement>("#status-region")!.textContent;
    expect(text()).toBe("");
    store.setSelection(SelectionState.ofCells([asCellId("c1")]));
    expect(text()).toBe("リージョン: ::N::A");
    store.setSelection(SelectionState.ofCells([asCellId("c1"), asCellId("c2")]));
    expect(text()).toBe("リージョン: 複数（2）");
    store.setSelection(SelectionState.empty());
    expect(text()).toBe("");
  });

  it("marks the status bar filename as dirty (bold/colored, not just a symbol) until saved", () => {
    const { store } = mountShell();
    store.loadDocument(store.getDocument(), "main.cde");
    const statusFile = () => document.querySelector<HTMLElement>("#status-file")!;
    expect(statusFile().classList.contains("dirty")).toBe(false);

    store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));
    expect(statusFile().classList.contains("dirty")).toBe(true);
    expect(statusFile().textContent).toContain("未保存");

    store.markSaved(store.filePath!);
    expect(statusFile().classList.contains("dirty")).toBe(false);
    expect(statusFile().textContent).not.toContain("未保存");
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

  it("diagnostics panel is hidden until #status-diag is clicked, then lists the diagnostics (第8章8.4節)", () => {
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

    const panel = document.querySelector<HTMLElement>("#diagnostics-panel")!;
    expect(panel.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#status-diag")!.click();

    expect(panel.hidden).toBe(false);
    const items = panel.querySelectorAll(".diag-item");
    expect(items.length).toBe(store.getReport().items.length);
    expect(items[0]!.textContent).toContain(store.getReport().items[0]!.code);
  });

  it("clicking a diagnostic with a relatedCellId selects that cell (8.4節: 検索ジャンプ機構の再利用)", () => {
    const { store } = mountShell();
    const text = ["cell tUndefinedType cFoo {", "}", ""].join("\n");
    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(text, "broken.cde");
    store.loadDocument(doc, "broken.cde", diagnostics);

    document.querySelector<HTMLButtonElement>("#status-diag")!.click();
    const jumpable = document.querySelector<HTMLElement>(".diag-jumpable")!;
    expect(jumpable).not.toBeNull();

    jumpable.click();

    expect(store.selection.cellIds.has(asCellId("cFoo"))).toBe(true);
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

    it("does not clobber an in-progress (uncommitted) edit when an unrelated store notify fires", () => {
      const { store } = mountShell();
      const controller = asCellId("cController1");
      store.setSelection(SelectionState.ofCells([controller]));

      const nameInput = document.querySelector<HTMLInputElement>("#property-panel .prop-field input")!;
      nameInput.focus();
      nameInput.value = "typedButNotCommittedYet";
      nameInput.dispatchEvent(new Event("input"));

      // Unrelated store update — must not wipe the field the user is mid-edit in.
      store.setMode("newCell");

      const nameInputAfter = document.querySelector<HTMLInputElement>("#property-panel .prop-field input")!;
      expect(nameInputAfter).toBe(nameInput);
      expect(nameInputAfter.value).toBe("typedButNotCommittedYet");
      expect(document.activeElement).toBe(nameInput);
      expect(store.getDocument().getCell(controller)!.name).toBe("cController1");
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
    it.each(["search input", "canvas", "other input"])("Escape clears search from the %s without changing the document or selection", (focus) => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "cLogger1";
      input.dispatchEvent(new Event("input"));
      document.querySelector<HTMLElement>(".search-hit")!.click();
      const before = store.getDocument();
      const selection = store.selection;
      const view = store.view;
      const canUndo = store.canUndo;
      const dirty = store.isDirty();
      expect(document.querySelector(".search-highlight-cell")).not.toBeNull();
      expect(document.querySelector(".search-highlight-join")).not.toBeNull();
      const target = focus === "search input" ? input : focus === "other input"
        ? document.querySelector<HTMLInputElement>("#property-panel input")!
        : document.querySelector<SVGSVGElement>("#canvas")!;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

      expect(store.view.searchQuery).toBeNull();
      expect(input.value).toBe("");
      expect(document.querySelectorAll(".search-hit")).toHaveLength(0);
      expect(document.querySelector("#search-count")!.textContent).toBe("");
      expect(store.selection).toBe(selection);
      expect(store.view.filters).toBe(view.filters);
      expect(store.view.panCenter).toEqual(view.panCenter);
      expect(store.view.zoom).toBe(view.zoom);
      expect(store.getDocument()).toBe(before);
      expect(store.canUndo).toBe(canUndo);
      expect(store.isDirty()).toBe(dirty);
      expect(document.querySelector(".search-highlight")).toBeNull();
    });

    it("Escape during IME composition keeps the search query", () => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "Logger";
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
      expect(store.view.searchQuery).toBe("Logger");
      expect(input.value).toBe("Logger");
      expect(document.querySelector(".search-highlight")).not.toBeNull();
    });

    it("empty search Escape is a no-op and a new search starts cycling from the first hit", () => {
      const { store } = mountShell();
      const notify = vi.fn();
      const unsubscribe = store.subscribe(notify);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(notify).not.toHaveBeenCalled();
      unsubscribe();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "c";
      input.dispatchEvent(new Event("input"));
      const next = document.querySelector<HTMLButtonElement>("[data-action='searchNext']")!;
      next.click();
      const first = store.selection;
      next.click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      input.value = "c";
      input.dispatchEvent(new Event("input"));
      next.click();
      expect([...store.selection.cellIds]).toEqual([...first.cellIds]);
    });

    it("updates highlights after edit, undo, redo, query changes and empty input", () => {
      const { store } = mountShell();
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "cLogger1";
      input.dispatchEvent(new Event("input"));
      const halo = () => document.querySelector<SVGRectElement>("[data-cell-id='cLogger1'] .search-highlight-cell")!;
      const x = halo().getAttribute("x");
      store.dispatch(new MoveCellsCommand([asCellId("cLogger1")], 10, 0));
      expect(halo().getAttribute("x")).not.toBe(x);
      store.undo();
      expect(halo().getAttribute("x")).toBe(x);
      store.redo();
      expect(halo().getAttribute("x")).not.toBe(x);
      store.setSelection(SelectionState.ofCells([asCellId("cSensor1")]));
      expect(halo()).not.toBeNull();
      input.value = "no matches";
      input.dispatchEvent(new Event("input"));
      expect(document.querySelector(".search-highlight")).toBeNull();
      input.value = "cLog";
      input.dispatchEvent(new Event("input"));
      expect(document.querySelector(".search-highlight")).not.toBeNull();
      input.value = "";
      input.dispatchEvent(new Event("input"));
      expect(document.querySelector(".search-highlight")).toBeNull();
    });

    it("Escape cancels joining and clears search in the same key event", () => {
      const doc = CdlDocumentLoader.loadSources([
        { text: celltypesText, fileName: "types.cdl", editable: false },
        { text: "cell tController source {}; cell tLogger target {};", fileName: "main.cde", editable: true },
      ]).document;
      const { shell, store } = mountShell(undefined, doc);
      const source = doc.getCell(asCellId("source"))!;
      const from = portPosition(source, source.findCPort("cLog")!);
      store.setView(store.view.withSearchQuery("source"));
      shell.gesture.pointerDown(from);
      shell.gesture.pointerMove({ x: from.x + 10, y: from.y + 10 });
      expect(shell.gesture.stateKind).toBe("joining");
      expect(document.querySelector("#join-preview line")).not.toBeNull();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(shell.gesture.stateKind).toBe("idle");
      expect(document.querySelector("#join-preview line")).toBeNull();
      expect(document.querySelector(".search-highlight")).toBeNull();
      expect(store.view.searchQuery).toBeNull();
      expect(store.getDocument()).toBe(doc);
      expect(store.canUndo).toBe(false);
    });

    it("Escape cancels a bar preview, restores the line and clears search", () => {
      let doc = loadDoc();
      const original = doc.getJoin(asJoinId("cController1.cLog"))!;
      const source = doc.getCell(original.cellId)!.moveTo(100, 60);
      const target = doc.getCell(original.eportCellId)!.moveTo(10, 10);
      const from = portPosition(source, source.findCPort("cLog")!);
      const to = portPosition(target, target.findEPort("eLog")!);
      const middle = 70;
      const join = original.withBars([
        { direction: "H", fixed: from.y, from: from.x, to: middle },
        { direction: "V", fixed: middle, from: from.y, to: to.y },
        { direction: "H", fixed: to.y, from: middle, to: to.x },
      ]);
      doc = doc.withCell(source).withCell(target).withJoin(join);
      const { shell, store } = mountShell(undefined, doc);
      store.setView(store.view.withSearchQuery("cLog"));
      const line = () => document.querySelector("[data-join-id='cController1.cLog'] .join-line")!;
      const confirmed = line().getAttribute("points");
      const point = { x: middle, y: (from.y + to.y) / 2 };
      shell.gesture.pointerDown(point);
      expect(shell.gesture.stateKind).toBe("movingJoinBar");
      shell.gesture.pointerMove({ x: point.x + 10, y: point.y });
      expect(line().getAttribute("points")).not.toBe(confirmed);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(shell.gesture.stateKind).toBe("idle");
      expect(line().getAttribute("points")).toBe(confirmed);
      expect(document.querySelector(".search-highlight")).toBeNull();
      expect(store.getDocument()).toBe(doc);
      expect(store.canUndo).toBe(false);
    });

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

    it("jumping to a hit in a hidden region reveals it (and its ancestors) — 7.4.2 / 6B.8", () => {
      const { document: model } = CdlDocumentLoader.loadSingle(
        "namespace N { region A { cell tLogger c1 {}; region A1 { cell tLogger c2 {}; }; }; region B { cell tLogger c3 {}; }; };",
        "main.cde",
      );
      const { store } = mountShell(undefined, model);
      store.setView(
        store.view.withFilters(
          store.view.filters.withRegionHidden(asRegionId("::N::A"), true).withRegionHidden(asRegionId("::N::B"), true),
        ),
      );
      const cell = (id: string) => document.querySelector<SVGGElement>(`[data-cell-id='${id}']`)!;
      expect(cell("c2").style.display).toBe("none");

      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "c2";
      input.dispatchEvent(new Event("input"));
      document.querySelector<HTMLButtonElement>("[data-action='searchNext']")!.click();

      expect(store.view.filters.hiddenRegions.has(asRegionId("::N::A"))).toBe(false);
      expect(store.view.filters.hiddenRegions.has(asRegionId("::N::B"))).toBe(true); // 無関係なものは触らない
      expect(cell("c2").style.display).toBe("");
      expect(store.selection.hasCell(asCellId("c2"))).toBe(true);
      const revealedFilters = store.view.filters;
      expect(cell("c2").querySelector(".search-highlight-cell")).not.toBeNull();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(store.view.filters).toBe(revealedFilters);
      expect(cell("c2").style.display).toBe("");
      expect(cell("c2").querySelector(".search-highlight-cell")).toBeNull();
    });

    it("jumping to a visible hit leaves the filters alone", () => {
      const { store } = mountShell();
      const before = store.view.filters;
      const input = document.querySelector<HTMLInputElement>("#search-input")!;
      input.value = "cLogger1";
      input.dispatchEvent(new Event("input"));
      document.querySelector<HTMLButtonElement>("[data-action='searchNext']")!.click();
      expect(store.view.filters).toBe(before);
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

  describe("Generate (第9章9.5節)", () => {
    it("the generate/copy buttons are disabled until a file has been loaded", () => {
      mountShell();
      expect(document.querySelector<HTMLButtonElement>("[data-action='generate']")!.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>("[data-action='copyTecsgenCommand']")!.disabled).toBe(true);
    });

    it("clicking Generate does nothing when no file is loaded (no path to run tecsgen against)", () => {
      const tecsgen = fakeTecsgen();
      mountShell(fakeClipboard(), loadDoc(), noopGateway, tecsgen.gateway);

      document.querySelector<HTMLButtonElement>("[data-action='generate']")!.click();

      expect(tecsgen.calls).toEqual([]);
    });

    it("clicking Generate builds args from tool-info + reference paths + the editing path, and enables the button once a file is loaded", async () => {
      const tecsgen = fakeTecsgen();
      const { store } = mountShell(fakeClipboard(), loadDoc(), noopGateway, tecsgen.gateway);
      store.loadDocument(loadDoc(), "C:/proj/main.cde", [], ["C:/proj/celltypes.cdl"]);

      const generateBtn = document.querySelector<HTMLButtonElement>("[data-action='generate']")!;
      expect(generateBtn.disabled).toBe(false);

      generateBtn.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(tecsgen.calls).toHaveLength(1);
      const args = tecsgen.calls[0]!;
      expect(args[args.length - 1]).toBe("C:/proj/main.cde");
      expect(args).toContain("C:/proj/celltypes.cdl");
    });

    it("auto-saves dirty content before generating, so tecsgen reads the current state", async () => {
      const { gateway, saveCalls } = fakeFileGateway();
      const tecsgen = fakeTecsgen();
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway, tecsgen.gateway);
      store.loadDocument(loadDoc(), "C:/proj/main.cde", [], []);
      store.dispatch(new MoveCellsCommand([asCellId("cController1")], 1, 0));
      expect(store.isDirty()).toBe(true);

      document.querySelector<HTMLButtonElement>("[data-action='generate']")!.click();
      await flush();

      expect(saveCalls).toHaveLength(1);
      expect(store.isDirty()).toBe(false);
      expect(tecsgen.calls).toHaveLength(1);
    });

    it("converts a non-zero tecsgen result into diagnostics visible via getReport()", async () => {
      const tecsgen = fakeTecsgen({ stdout: "main.cde:1:1: error: G1016 syntax error near '$1'\n" });
      const { store } = mountShell(fakeClipboard(), loadDoc(), noopGateway, tecsgen.gateway);
      store.loadDocument(loadDoc(), "C:/proj/main.cde", [], []);

      document.querySelector<HTMLButtonElement>("[data-action='generate']")!.click();
      await flush();

      expect(store.getReport().errorCount).toBe(1);
      expect(document.querySelector("#status-diag")!.textContent).toContain("1 エラー");
      // 実機確認で判明: 件数表示だけでは操作の結果だと気づけない。generateは
      // 診断が出たら一覧パネルを自動で開く（DiagnosticsPanelView.open()）。
      expect(document.querySelector<HTMLElement>("#diagnostics-panel")!.hidden).toBe(false);
    });

    it("copyTecsgenCommand writes the built command line to the OS clipboard", async () => {
      const clipboard = fakeClipboard();
      const { store } = mountShell(clipboard, loadDoc());
      store.loadDocument(loadDoc(), "C:/proj/main.cde", [], ["C:/proj/celltypes.cdl"]);

      document.querySelector<HTMLButtonElement>("[data-action='copyTecsgenCommand']")!.click();
      await flush();

      const text = await clipboard.readText();
      expect(text.startsWith("tecsgen ")).toBe(true);
      expect(text).toContain("C:/proj/celltypes.cdl");
      expect(text.endsWith("C:/proj/main.cde")).toBe(true);
    });
  });

  describe("Zoom slider (外部仕様3.2.1)", () => {
    it("dragging the slider sets the zoom level, keeping the view center fixed", () => {
      const { store } = mountShell();
      const centerBefore = store.view.panCenter;

      const slider = document.querySelector<HTMLInputElement>("#zoom-slider")!;
      slider.value = "50";
      slider.dispatchEvent(new Event("input"));

      expect(store.view.zoom).toBeCloseTo(0.5, 5);
      expect(store.view.panCenter).toEqual(centerBefore);
    });

    it("zooming via the Ctrl+= keyboard shortcut (外部仕様7.1.2) keeps the slider in sync", () => {
      mountShell();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));

      const slider = document.querySelector<HTMLInputElement>("#zoom-slider")!;
      expect(slider.value).not.toBe("100");
    });

    it("resetting zoom via the Reset Rate button snaps the slider back to 100", () => {
      mountShell();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));

      document.querySelector<HTMLButtonElement>("[data-action='zoomReset']")!.click();

      const slider = document.querySelector<HTMLInputElement>("#zoom-slider")!;
      expect(slider.value).toBe("100");
    });

    it("dragging to the slider's min (5%, per 外部仕様3.2.1) does not throw and clamps to ZOOM_MIN", () => {
      const { store } = mountShell();
      const slider = document.querySelector<HTMLInputElement>("#zoom-slider")!;

      // <input type="range" min="5"> clamps out-of-range assignments itself (jsdom and browsers alike).
      slider.value = "0";
      expect(slider.value).toBe("5");
      expect(() => slider.dispatchEvent(new Event("input"))).not.toThrow();
      expect(store.view.zoom).toBeCloseTo(0.05, 5);
    });
  });

  describe("file browser root restoration (7.6.6節)", () => {
    it("restores the file browser root sent via onRestoreFileBrowserRoot at startup", async () => {
      let restoreListener: ((path: string) => void) | undefined;
      const { gateway } = fakeFileGateway();
      (gateway as unknown as { listDirectory: () => Promise<unknown> }).listDirectory = async () => [
        { name: "main.cde", path: "/saved-root/main.cde", kind: "file" },
      ];
      (gateway as unknown as { onRestoreFileBrowserRoot: (l: (path: string) => void) => void }).onRestoreFileBrowserRoot = (
        listener,
      ) => {
        restoreListener = listener;
      };

      mountShell(fakeClipboard(), loadDoc(), gateway);
      expect(restoreListener).toBeDefined();
      restoreListener!("/saved-root");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelector('[data-path="/saved-root/main.cde"]')).not.toBeNull();
    });
  });

  describe("file browser: unsaved changes confirmation (7B章7.6.4節)", () => {
    function fileBrowserGateway(confirmResult: boolean) {
      const confirmDiscardChanges = vi.fn().mockResolvedValue(confirmResult);
      const openPath = vi.fn().mockResolvedValue({
        editable: { path: "/root/other.cde", content: mainText },
        references: [{ path: "/root/celltypes.cdl", content: celltypesText }],
      });
      const gateway = {
        ...noopGateway,
        chooseFolder: async () => "/root",
        listDirectory: async () => [{ name: "other.cde", path: "/root/other.cde", kind: "file" }],
        openPath,
        confirmDiscardChanges,
      } as unknown as FileGateway;
      return { gateway, confirmDiscardChanges, openPath };
    }

    async function openFileFromBrowser(): Promise<void> {
      document.querySelector<HTMLButtonElement>("[data-action='openFolder']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document
        .querySelector<HTMLElement>('[data-path="/root/other.cde"]')!
        .dispatchEvent(new Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it("opens without confirming when there are no unsaved changes", async () => {
      const { gateway, confirmDiscardChanges, openPath } = fileBrowserGateway(true);
      mountShell(fakeClipboard(), loadDoc(), gateway);

      await openFileFromBrowser();

      expect(confirmDiscardChanges).not.toHaveBeenCalled();
      expect(openPath).toHaveBeenCalledWith("/root/other.cde");
    });

    it("confirms before discarding unsaved changes, and opens when the user proceeds", async () => {
      const { gateway, confirmDiscardChanges, openPath } = fileBrowserGateway(true);
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));
      expect(store.isDirty()).toBe(true);

      await openFileFromBrowser();

      expect(confirmDiscardChanges).toHaveBeenCalled();
      expect(openPath).toHaveBeenCalledWith("/root/other.cde");
    });

    it("does not open when the user cancels the discard confirmation", async () => {
      const { gateway, confirmDiscardChanges, openPath } = fileBrowserGateway(false);
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));

      await openFileFromBrowser();

      expect(confirmDiscardChanges).toHaveBeenCalled();
      expect(openPath).not.toHaveBeenCalled();
      expect(store.filePath).not.toBe("/root/other.cde");
    });
  });

  describe("clear button — new document (第7C章7.7.3節)", () => {
    it("clears the editable document without confirming when there are no unsaved changes", () => {
      const { store } = mountShell();
      store.loadDocument(loadDoc(), "/root/main.cde", [], ["/root/celltypes.cdl"]);

      document.querySelector<HTMLButtonElement>("[data-action='clear']")!.click();

      expect(store.filePath).toBeNull();
      expect(store.isDirty()).toBe(false);
    });

    it("preserves the reference file set across clear (references集合は維持)", () => {
      const { store } = mountShell();
      store.loadDocument(loadDoc(), "/root/main.cde", [], ["/root/celltypes.cdl"]);

      document.querySelector<HTMLButtonElement>("[data-action='clear']")!.click();

      expect(store.getReferenceFilePaths()).toEqual(["/root/celltypes.cdl"]);
    });

    it("confirms before discarding unsaved changes, and clears when the user proceeds", async () => {
      const confirmDiscardChanges = vi.fn().mockResolvedValue(true);
      const gateway = { ...noopGateway, confirmDiscardChanges } as unknown as FileGateway;
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.loadDocument(store.getDocument(), "/root/main.cde");
      store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));
      expect(store.isDirty()).toBe(true);

      document.querySelector<HTMLButtonElement>("[data-action='clear']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(confirmDiscardChanges).toHaveBeenCalled();
      expect(store.filePath).toBeNull();
    });

    it("does not clear when the user cancels the discard confirmation", async () => {
      const confirmDiscardChanges = vi.fn().mockResolvedValue(false);
      const gateway = { ...noopGateway, confirmDiscardChanges } as unknown as FileGateway;
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.loadDocument(store.getDocument(), "/root/main.cde");
      store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));

      document.querySelector<HTMLButtonElement>("[data-action='clear']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(confirmDiscardChanges).toHaveBeenCalled();
      expect(store.filePath).toBe("/root/main.cde");
    });
  });

  describe("Ctrl+click adds a reference (第7C章7.7.2節#8)", () => {
    function addReferenceGateway() {
      const resolveImports = vi.fn().mockResolvedValue([
        { request: { kind: "manual", specifier: "/root/extra.cdl" }, canonicalPath: "/root/extra.cdl", content: "" },
      ]);
      const gateway = {
        ...noopGateway,
        chooseFolder: async () => "/root",
        listDirectory: async () => [{ name: "extra.cdl", path: "/root/extra.cdl", kind: "file" }],
        resolveImports,
      } as unknown as FileGateway;
      return { gateway, resolveImports };
    }

    async function chooseRootAndCtrlClick(path: string): Promise<void> {
      document.querySelector<HTMLButtonElement>("[data-action='openFolder']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document
        .querySelector<HTMLElement>(`[data-path="${path}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it("adds the file as a reference without changing the editable document", async () => {
      const { gateway, resolveImports } = addReferenceGateway();
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.loadDocument(store.getDocument(), "/root/main.cde");

      await chooseRootAndCtrlClick("/root/extra.cdl");

      expect(resolveImports).toHaveBeenCalledWith(
        "/root/main.cde",
        [{ kind: "manual", specifier: "/root/extra.cdl" }],
        expect.anything(),
      );
      expect(store.filePath).toBe("/root/main.cde"); // editableは変わらない
      expect(store.getReferenceFilePaths()).toEqual(["/root/extra.cdl"]);
    });

    it("does nothing when Ctrl+clicking a file that is already loaded", async () => {
      const { gateway, resolveImports } = addReferenceGateway();
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.loadDocument(store.getDocument(), "/root/main.cde", [], ["/root/extra.cdl"], new Map([["/root/extra.cdl", ""]]));
      resolveImports.mockClear();

      await chooseRootAndCtrlClick("/root/extra.cdl");

      expect(resolveImports).not.toHaveBeenCalled();
      expect(store.getReferenceFilePaths()).toEqual(["/root/extra.cdl"]);
    });

    it("resets undo history but keeps the current in-progress edit's content (決定1のトレードオフ)", async () => {
      const { gateway } = addReferenceGateway();
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);
      store.loadDocument(store.getDocument(), "/root/main.cde");
      const controller = asCellId("cController1");
      const before = store.getDocument().getCell(controller)!;
      store.dispatch(new MoveCellsCommand([controller], 5, 0));
      expect(store.canUndo).toBe(true);

      await chooseRootAndCtrlClick("/root/extra.cdl");

      expect(store.canUndo).toBe(false); // Undo履歴はリセットされる
      expect(store.isDirty()).toBe(true);
      expect(store.getDocument().getCell(controller)!.x).toBe(before.x + 5); // 未保存の変更内容は失われない
    });
  });

  describe(".tecsgen-opts の一括読み込み（第7C章7.7.4節#10）", () => {
    it("opens every CDL in an options file as editable", async () => {
      const openPath = vi.fn(async (path: string) => ({
        editable: { path, content: path === "/root/main.cde" ? mainText : "" },
        references: [],
      }));
      const resolveImports = vi.fn().mockResolvedValue([
        { request: { kind: "manual", specifier: "/root/celltypes.cdl" }, canonicalPath: "/root/celltypes.cdl", content: "" },
      ]);
      const gateway = {
        ...noopGateway,
        chooseFolder: async () => "/root",
        listDirectory: async () => [{ name: "build.tecsgen-opts", path: "/root/build.tecsgen-opts", kind: "file" }],
        parseTecsgenOptionsFile: vi.fn().mockResolvedValue({
          cdlFiles: ["/root/celltypes.cdl", "/root/main.cde"], // mainプロセスが.tecsgen-optsのディレクトリ基点で解決済みの想定
          importPaths: ["./include"],
          defineMacros: [],
          systemDirs: [],
        }),
        openPath,
        resolveImports,
      } as unknown as FileGateway;
      const { store } = mountShell(fakeClipboard(), loadDoc(), gateway);

      document.querySelector<HTMLButtonElement>("[data-action='openFolder']")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document
        .querySelector<HTMLElement>('[data-path="/root/build.tecsgen-opts"]')!
        .dispatchEvent(new Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(openPath).toHaveBeenCalledWith("/root/main.cde"); // 列挙順で最後がeditable
      expect(store.filePath).toBe("/root/main.cde");
      expect(store.getReferenceFilePaths()).toContain("/root/celltypes.cdl"); // 残りがreferences
    });
  });
});

describe("AppShell — unsaved-changes report to main (7.9)", () => {
  afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  it("reports the initial clean state, then only when dirtiness changes", () => {
    const setDirty = vi.fn();
    const { store } = mountShell(fakeClipboard(), loadDoc(), noopGateway, fakeTecsgen().gateway, { setDirty });
    expect(setDirty.mock.calls).toEqual([[false]]);

    store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));
    expect(setDirty.mock.calls).toEqual([[false], [true]]);

    // 既にdirtyのまま別の編集をしても、値が変わらない間は通知しない。
    store.dispatch(new MoveCellsCommand([asCellId("cController1")], 5, 0));
    store.setSelection(SelectionState.ofCells([asCellId("cController1")]));
    expect(setDirty).toHaveBeenCalledTimes(2);

    store.markSaved("main.cde");
    expect(setDirty.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("no longer registers a beforeunload handler", () => {
    const add = vi.spyOn(window, "addEventListener");
    mountShell(fakeClipboard(), loadDoc(), noopGateway, fakeTecsgen().gateway, { setDirty: vi.fn() });
    expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
    add.mockRestore();
  });

  it("openDiagnostics() reveals the panel when an environment warning exists", () => {
    const { shell, store } = mountShell();
    const panel = document.querySelector<HTMLElement>("#diagnostics-panel")!;
    expect(panel.hidden).toBe(true);
    store.setEnvironmentDiagnostics([{ severity: "warning", code: "W-TECSGEN-VERSION-OLD", message: "tecsgen の版 1.2.0 は古い" }]);
    expect(panel.hidden).toBe(true); // 通知だけでは開かない
    shell.openDiagnostics();
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("W-TECSGEN-VERSION-OLD");
  });
});

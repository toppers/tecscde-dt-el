/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { SelectionState } from "../../src/renderer/render/view";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { Diagnostic } from "../../src/renderer/diagnostics/types";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
let shell: AppShell | undefined;
const diagnostics = (count: number): Diagnostic[] => Array.from({ length: count }, (_, i) => ({
  severity: "warning", code: `W-${i}`, message: `warning ${i}`, relatedCellId: asCellId("Main"),
  location: { file: "main.cdl", line: i + 1, column: 2 },
}));
function mount() {
  document.head.innerHTML = html.split("<head>")[1]!.split("</head>")[0]!;
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(CdlDocumentLoader.loadSingle("signature sMain { void f(void); };\ncelltype tMain { entry sMain e; };\ncell tMain Main {};\n", "main.cdl").document);
  expect(store.getReport().items).toEqual([]);
  shell = new AppShell({ root: document, store, win: window,
    gateway: { onRestoreFileBrowserRoot: vi.fn() } as unknown as FileGateway,
    tecsgen: {} as never, clipboard: {} as never });
  shell.start();
  return { store, panel: document.querySelector<HTMLElement>("#diagnostics-panel")!,
    scroll: document.querySelector<HTMLElement>("#canvas-scroll")!,
    toggle: document.querySelector<HTMLButtonElement>("#status-diag")! };
}
afterEach(() => { shell?.dispose(); shell = undefined; document.head.replaceChildren(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Stage 1 diagnostics layout contract", () => {
  it("uses a normal layout row between the shrinking canvas row and statusbar, including auto-open", () => {
    const { store, panel, toggle } = mount();
    expect(panel.hidden).toBe(true);
    expect(panel.previousElementSibling?.id).toBe("main");
    expect(panel.nextElementSibling?.id).toBe("statusbar");
    expect(getComputedStyle(document.querySelector("#app")!).flexDirection).toBe("column");
    expect(getComputedStyle(panel).position).not.toBe("absolute");
    expect(getComputedStyle(document.querySelector("#main")!).minHeight).toBe("120px");
    expect(getComputedStyle(document.querySelector("#canvas-scroll")!).alignItems).toBe("flex-start");
    store.setEnvironmentDiagnostics(diagnostics(1));
    expect(panel.hidden).toBe(false);
    toggle.click();
    expect(panel.hidden).toBe(true);
    shell!.render();
    expect(panel.hidden).toBe(true);
    toggle.click();
    expect(panel.hidden).toBe(false);
    store.setEnvironmentDiagnostics([]);
    expect(panel.hidden).toBe(true);
    expect(toggle.disabled).toBe(true);
  });

  it("fits actual rows, caps at ten rows and scrolls internally with unchanged content and jump", () => {
    const { store, panel } = mount();
    const style = getComputedStyle(panel);
    expect(style.overflowY).toBe("auto");
    expect(style.maxHeight).toBe("calc(27px * 10)");
    store.setEnvironmentDiagnostics(diagnostics(3));
    expect(panel.querySelectorAll(".diag-item")).toHaveLength(3);
    expect(getComputedStyle(panel).height).toBe("auto");
    store.setEnvironmentDiagnostics(diagnostics(12));
    expect(panel.querySelectorAll(".diag-item")).toHaveLength(12);
    const row = panel.querySelector<HTMLElement>(".diag-item")!;
    expect(row.textContent).toBe("[W-0] main.cdl:1:2: warning 0");
    row.click();
    expect(store.selection.hasCell(asCellId("Main"))).toBe(true);
    expect(panel.hidden).toBe(false);
  });

  it("recalculates the viewport through ResizeObserver while preserving scroll, zoom, document and selection", () => {
    let resize: (() => void) | undefined;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe; disconnect = disconnect;
    });
    const { store, panel, scroll, toggle } = mount();
    let viewportHeight = 700;
    Object.defineProperties(scroll, { clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, get: () => viewportHeight } });
    store.setView(store.view.panTo({ x: 180, y: 160 }));
    store.setSelection(SelectionState.ofCells([asCellId("Main")]));
    resize?.();
    const before = { left: scroll.scrollLeft, top: scroll.scrollTop, document: store.getDocument(),
      selection: store.selection, history: store.history, zoom: store.view.zoom, dirty: store.isDirty() };
    store.setEnvironmentDiagnostics(diagnostics(3));
    expect(panel.hidden).toBe(false);
    viewportHeight = 622;
    resize?.();
    expect(observe).toHaveBeenCalledWith(scroll);
    expect(scroll.scrollLeft).toBe(before.left);
    expect(scroll.scrollTop).toBe(before.top);
    shell!.render();
    expect(scroll.scrollTop).toBe(before.top);
    toggle.click();
    viewportHeight = 700;
    resize?.();
    expect(scroll.scrollTop).toBe(before.top);
    expect(store.getDocument()).toBe(before.document);
    expect(store.selection).toBe(before.selection);
    expect(store.history).toBe(before.history);
    expect(store.view.zoom).toBe(before.zoom);
    expect(store.isDirty()).toBe(before.dirty);
    shell!.dispose(); shell = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("caps by the measured first ten diagnostic rows, counting a wrapped diagnostic as one row", () => {
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("diag-item")) return new DOMRect(0, 0, 600, this.textContent?.includes("warning 0") ? 54 : 27);
      return rect.call(this);
    });
    const { store, panel } = mount();
    store.setEnvironmentDiagnostics(diagnostics(3));
    expect(panel.style.maxHeight).toBe("108px");
    store.setEnvironmentDiagnostics(diagnostics(12));
    expect(panel.style.maxHeight).toBe("297px");
  });
});

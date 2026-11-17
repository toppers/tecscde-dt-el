/** @vitest-environment happy-dom */
// 三者相違一覧 7-10（2026-11-17 決定、V0.2.6 段5）: 表示倍率は 5% 刻みの整数値にする。
// Ctrl+／Ctrl−／Ctrl+ホイールの1回の操作で 5% ずつ増減する（範囲 5%〜200%）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { ViewState, ZOOM_MAX, ZOOM_MIN, snapZoom } from "../../src/renderer/view-state";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
const percent = (zoom: number): number => Math.round(zoom * 100);

describe("ViewState.stepZoom", () => {
  const anchor = { x: 40, y: 30 };

  it("moves by exactly 5% per step from 100%", () => {
    let view = ViewState.initial();
    const seen: number[] = [];
    for (let i = 0; i < 3; i += 1) { view = view.stepZoom(anchor, 1); seen.push(percent(view.zoom)); }
    expect(seen).toEqual([105, 110, 115]);
    for (let i = 0; i < 4; i += 1) { view = view.stepZoom(anchor, -1); seen.push(percent(view.zoom)); }
    expect(seen.slice(3)).toEqual([110, 105, 100, 95]);
  });

  it("always yields an integer percent that is a multiple of 5", () => {
    let view = ViewState.initial();
    for (let i = 0; i < 60; i += 1) {
      view = view.stepZoom(anchor, i % 7 === 0 ? -1 : 1);
      expect(view.zoom * 100).toBeCloseTo(Math.round(view.zoom * 100), 9);
      expect(percent(view.zoom) % 5).toBe(0);
    }
  });

  it("does not go below 5% or above 200%", () => {
    let low = ViewState.initial().zoomAt(anchor, 0.01); // 下限へ
    expect(low.zoom).toBe(ZOOM_MIN);
    expect(low.stepZoom(anchor, -1).zoom).toBe(ZOOM_MIN);
    expect(percent(low.stepZoom(anchor, 1).zoom)).toBe(10);
    const high = ViewState.initial().zoomAt(anchor, 10);
    expect(high.zoom).toBe(ZOOM_MAX);
    expect(high.stepZoom(anchor, 1).zoom).toBe(ZOOM_MAX);
    expect(percent(high.stepZoom(anchor, -1).zoom)).toBe(195);
  });

  it("snaps a value that is not a multiple of 5 to the next multiple in the step direction", () => {
    const odd = ViewState.initial().zoomAt(anchor, 1.03);
    expect(percent(odd.stepZoom(anchor, 1).zoom)).toBe(105);
    expect(percent(odd.stepZoom(anchor, -1).zoom)).toBe(100);
  });

  it("keeps the model point under the anchor fixed, like zoomAt", () => {
    const view = ViewState.initial().panTo({ x: 100, y: 60 });
    const next = view.stepZoom(anchor, 1);
    const before = (anchor.x - view.panCenter.x) * view.zoom;
    const after = (anchor.x - next.panCenter.x) * next.zoom;
    expect(after).toBeCloseTo(before, 6);
  });
});

describe("snapZoom", () => {
  it("rounds to the nearest 5% and clamps to 5%〜200%", () => {
    expect(percent(snapZoom(1.02))).toBe(100);
    expect(percent(snapZoom(1.03))).toBe(105);
    expect(snapZoom(0.001)).toBe(ZOOM_MIN);
    expect(snapZoom(9)).toBe(ZOOM_MAX);
    expect(snapZoom(Number.NaN)).toBe(1);
  });
});

let shell: AppShell | undefined;
afterEach(() => { shell?.dispose(); shell = undefined; document.head.replaceChildren(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mountShell() {
  document.head.innerHTML = html.split("<head>")[1]!.split("</head>")[0]!;
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(CdlDocumentLoader.loadSingle("signature sMain { void f(void); };\ncelltype tMain { entry sMain e; };\ncell tMain Main {};\n", "main.cdl").document);
  shell = new AppShell({ root: document, store, win: window,
    gateway: { onRestoreFileBrowserRoot: vi.fn() } as unknown as FileGateway, tecsgen: {} as never, clipboard: {} as never });
  shell.start();
  return { store, slider: document.querySelector<HTMLInputElement>("#zoom-slider")! };
}

describe("shell の倍率操作", () => {
  it("steps by 5% with Ctrl+= and Ctrl+-, keeping the slider and the model value equal", () => {
    const { store, slider } = mountShell();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    expect(store.view.zoom).toBe(1.1);
    expect(slider.value).toBe("110");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }));
    expect(store.view.zoom).toBe(1.05);
    expect(slider.value).toBe("105");
  });

  it("steps by 5% per Ctrl+wheel event", () => {
    const { store } = mountShell();
    const scroll = document.querySelector<HTMLElement>("#canvas-scroll")!;
    // happy-dom の WheelEvent は修飾キーの初期値を受け取らないことがあるため、値を直接持たせる。
    const wheel = (deltaY: number): void => {
      scroll.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), { ctrlKey: true, deltaY, clientX: 0, clientY: 0 }));
    };
    wheel(-100); wheel(-100);
    expect(percent(store.view.zoom)).toBe(110);
    wheel(100);
    expect(percent(store.view.zoom)).toBe(105);
  });

  it("snaps a slider value to a multiple of 5 and the slider itself moves in steps of 5", () => {
    const { store, slider } = mountShell();
    expect(slider.step).toBe("5");
    slider.value = "103";
    slider.dispatchEvent(new Event("input"));
    expect(percent(store.view.zoom)).toBe(105);
    expect(slider.value).toBe("105");
  });
});

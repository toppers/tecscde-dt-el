// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節 — preload が exposeInMainWorld で公開する
// window.tecscde API の配線を検証する。実際のcontextBridgeによる分離世界への
// 橋渡しは実Electron環境でしか検証できないため（第11章11.4節#2の残課題）、
// ここでは「渡されるAPIオブジェクトが正しいIPCチャネル名・clipboard APIを
// 呼び出すこと」を検証範囲とする。

import { describe, expect, it, vi } from "vitest";
import type { TecscdeApi } from "../../src/shared/ipc-types.js";

// vi.mock はファイル先頭へホイストされるため、その factory が参照する mock は
// vi.hoisted で同じくホイストして TDZ を避ける（第11章11.4節#2の残課題対応）。
const { invoke, once, writeText, readText, exposeInMainWorld } = vi.hoisted(() => ({
  invoke: vi.fn(),
  once: vi.fn(),
  writeText: vi.fn(),
  readText: vi.fn().mockResolvedValue("clip-content"),
  exposeInMainWorld: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, once },
  clipboard: { writeText, readText },
}));

// preload は ESM（第11章11.2節#1の決定）のため、`clipboard` だけは
// `createRequire(import.meta.url)("electron")` で CJS 版から取得している
// （ESMの`electron`は preload 向けに clipboard を名前付きエクスポートしないため）。
// この経路は vitest の vi.mock("electron") を通らないので、createRequire 自体をモックする。
vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:module")>()),
  createRequire: () => (id: string) => {
    if (id === "electron") return { clipboard: { writeText, readText } };
    throw new Error(`unexpected require(${id})`);
  },
}));

await import("../../src/preload/index.mjs");

// preload は import 時（＝各 it より前）に一度だけ exposeInMainWorld を呼ぶ。
// vitest 5 は既定で各テスト前に mock の呼び出し履歴をクリアするため、
// この一度きりの呼び出しはモジュールスコープで捕捉しておく。
const exposeCalls = exposeInMainWorld.mock.calls;
expect(exposeCalls).toHaveLength(1);
const [exposedKey, exposedApiObject] = exposeCalls[0]! as [string, TecscdeApi];
expect(exposedKey).toBe("tecscde");

function exposedApi(): TecscdeApi {
  return exposedApiObject;
}

describe("preload", () => {
  it("file.open invokes the file:open channel", () => {
    exposedApi().file.open();
    expect(invoke).toHaveBeenCalledWith("file:open");
  });

  it("file.save invokes file:save with path and content", () => {
    exposedApi().file.save("/a.cde", "content");
    expect(invoke).toHaveBeenCalledWith("file:save", "/a.cde", "content");
  });

  it("file.saveAs invokes file:saveAs with content and suggested name", () => {
    exposedApi().file.saveAs("content", "untitled.cde");
    expect(invoke).toHaveBeenCalledWith("file:saveAs", "content", "untitled.cde");
  });

  it("file.export invokes file:export with path and data", () => {
    exposedApi().file.export("/out.txt", "data");
    expect(invoke).toHaveBeenCalledWith("file:export", "/out.txt", "data");
  });

  it("tecsgen.generate invokes tecsgen:generate with args", () => {
    exposedApi().tecsgen.generate(["-c", "main.cde"]);
    expect(invoke).toHaveBeenCalledWith("tecsgen:generate", ["-c", "main.cde"]);
  });

  it("tecsgen.version invokes tecsgen:version", () => {
    exposedApi().tecsgen.version();
    expect(invoke).toHaveBeenCalledWith("tecsgen:version");
  });

  it("clipboard.writeText/readText bridge directly to Electron's clipboard (no ipcMain, 2.4節)", async () => {
    await exposedApi().clipboard.writeText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    await expect(exposedApi().clipboard.readText()).resolves.toBe("clip-content");
    expect(invoke).not.toHaveBeenCalledWith(expect.stringContaining("clipboard"));
  });

  it("onBootstrap registers a one-shot listener on the app:bootstrap channel (7.4節)", () => {
    const listener = vi.fn();
    exposedApi().onBootstrap(listener);
    expect(once).toHaveBeenCalledWith("app:bootstrap", expect.any(Function));

    // 受信ハンドラは (event, data) を剥がして listener(data) を呼ぶ。
    const received = once.mock.calls.at(-1)![1] as (e: unknown, d: unknown) => void;
    received({}, { editable: { path: "x.cde", content: "" }, references: [] });
    expect(listener).toHaveBeenCalledWith({ editable: { path: "x.cde", content: "" }, references: [] });
  });
});

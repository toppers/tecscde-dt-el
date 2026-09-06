// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節 — preload が exposeInMainWorld で公開する
// window.tecscde API の配線を検証する。実際のcontextBridgeによる分離世界への
// 橋渡しは実Electron環境でしか検証できないため（第11章11.4節#2の残課題）、
// ここでは「渡されるAPIオブジェクトが正しいIPCチャネル名・clipboard APIを
// 呼び出すこと」を検証範囲とする。

import { describe, expect, it, vi } from "vitest";
import type { TecscdeApi } from "../../src/shared/ipc-types.js";

const invoke = vi.fn();
const writeText = vi.fn();
const readText = vi.fn().mockReturnValue("clip-content");
const exposeInMainWorld = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
  clipboard: { writeText, readText },
}));

await import("../../src/preload/index.js");

function exposedApi(): TecscdeApi {
  expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
  const [key, api] = exposeInMainWorld.mock.calls[0]!;
  expect(key).toBe("tecscde");
  return api as TecscdeApi;
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

  it("clipboard.writeText/readText bridge directly to Electron's clipboard (no ipcMain, 2.4節)", () => {
    exposedApi().clipboard.writeText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(exposedApi().clipboard.readText()).toBe("clip-content");
    expect(invoke).not.toHaveBeenCalledWith(expect.stringContaining("clipboard"));
  });
});

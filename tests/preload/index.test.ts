// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節 — preload が exposeInMainWorld で公開する
// window.tecscde API の配線を検証する。実際のcontextBridgeによる分離世界への
// 橋渡しは実Electron環境でしか検証できないため（第11章11.4節#2の残課題）、
// ここでは「渡されるAPIオブジェクトが正しいIPCチャネル名を呼び出すこと」を検証範囲とする。
// clipboardも他と同じくipcMain経由（実機確認でcreateRequire経由のclipboard直取得が
// 動作しないと判明し、2026-09-20に変更）。

import { describe, expect, it, vi } from "vitest";
import type { TecscdeApi } from "../../src/shared/ipc-types.js";

// vi.mock はファイル先頭へホイストされるため、その factory が参照する mock は
// vi.hoisted で同じくホイストして TDZ を避ける（第11章11.4節#2の残課題対応）。
const { invoke, once, exposeInMainWorld } = vi.hoisted(() => ({
  invoke: vi.fn(),
  once: vi.fn(),
  exposeInMainWorld: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, once },
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

  it("file.chooseFolder invokes the file:chooseFolder channel", () => {
    exposedApi().file.chooseFolder();
    expect(invoke).toHaveBeenCalledWith("file:chooseFolder");
  });

  it("file.listDirectory invokes file:listDirectory with the directory path", () => {
    exposedApi().file.listDirectory("/root");
    expect(invoke).toHaveBeenCalledWith("file:listDirectory", "/root");
  });

  it("file.openPath invokes file:openPath with the path", () => {
    exposedApi().file.openPath("/root/main.cde");
    expect(invoke).toHaveBeenCalledWith("file:openPath", "/root/main.cde");
  });

  it("file.confirmDiscardChanges invokes the file:confirmDiscardChanges channel", () => {
    exposedApi().file.confirmDiscardChanges();
    expect(invoke).toHaveBeenCalledWith("file:confirmDiscardChanges");
  });

  it("file.resolveImports invokes file:resolveImports with editablePath, requests, and options (7D章7.5.2節)", () => {
    const requests = [{ kind: "import" as const, specifier: "celltypes.cdl" }];
    const options = { importPaths: ["."] };
    exposedApi().file.resolveImports("/root/main.cde", requests, options);
    expect(invoke).toHaveBeenCalledWith("file:resolveImports", "/root/main.cde", requests, options);
  });

  it("file.saveSession invokes file:saveSession with editablePath and referencePaths (7.7.1節)", () => {
    exposedApi().file.saveSession("/root/main.cde", ["/root/celltypes.cdl"]);
    expect(invoke).toHaveBeenCalledWith("file:saveSession", "/root/main.cde", ["/root/celltypes.cdl"]);
  });

  it("tecsgen.generate invokes tecsgen:generate with args", () => {
    exposedApi().tecsgen.generate(["-c", "main.cde"]);
    expect(invoke).toHaveBeenCalledWith("tecsgen:generate", ["-c", "main.cde"]);
  });

  it("tecsgen.preprocess invokes tecsgen:preprocess with headerPath and cppCommand", () => {
    exposedApi().tecsgen.preprocess("header.h", "gcc -E");
    expect(invoke).toHaveBeenCalledWith("tecsgen:preprocess", "header.h", "gcc -E");
  });

  it("tecsgen.version invokes tecsgen:version", () => {
    exposedApi().tecsgen.version();
    expect(invoke).toHaveBeenCalledWith("tecsgen:version");
  });

  it("clipboard.writeText invokes clipboard:writeText with the text", () => {
    exposedApi().clipboard.writeText("hello");
    expect(invoke).toHaveBeenCalledWith("clipboard:writeText", "hello");
  });

  it("clipboard.readText invokes clipboard:readText", () => {
    exposedApi().clipboard.readText();
    expect(invoke).toHaveBeenCalledWith("clipboard:readText");
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

  it("onRestoreFileBrowserRoot registers a one-shot listener on the app:fileBrowserRoot channel (7.6.6節)", () => {
    const listener = vi.fn();
    exposedApi().onRestoreFileBrowserRoot(listener);
    expect(once).toHaveBeenCalledWith("app:fileBrowserRoot", expect.any(Function));

    const received = once.mock.calls.at(-1)![1] as (e: unknown, path: string) => void;
    received({}, "/root");
    expect(listener).toHaveBeenCalledWith("/root");
  });
});

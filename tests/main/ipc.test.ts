// [[TECSCDE-DT-EL内部仕様]] 第7章7.2節・第9章9.2節 — IPCチャネル名とハンドラの配線を検証する。
// チャネル名の変更は preload 側と暗黙に同期しなければならない契約であるため、
// registerIpcHandlers が正しいチャネル名へ正しいメソッドを結びつけていることを確認する。

import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

const { registerIpcHandlers } = await import("../../src/main/ipc.js");

describe("registerIpcHandlers", () => {
  it("wires every file:* and tecsgen:* channel to the corresponding service method", () => {
    const fileService = {
      openDialog: vi.fn().mockResolvedValue("open-result"),
      save: vi.fn().mockResolvedValue(undefined),
      saveAsDialog: vi.fn().mockResolvedValue("saved-path"),
      exportFile: vi.fn().mockResolvedValue(undefined),
    };
    const tecsgenRunner = {
      run: vi.fn().mockResolvedValue("run-result"),
      version: vi.fn().mockResolvedValue("1.9.1"),
    };

    registerIpcHandlers(fileService as never, tecsgenRunner as never);

    expect([...handlers.keys()].sort()).toEqual(
      ["cdl:grammar-assets", "file:export", "file:open", "file:save", "file:saveAs", "tecsgen:generate", "tecsgen:version"].sort(),
    );

    handlers.get("file:open")!({});
    expect(fileService.openDialog).toHaveBeenCalled();

    handlers.get("file:save")!({}, "/tmp/a.cde", "content");
    expect(fileService.save).toHaveBeenCalledWith("/tmp/a.cde", "content");

    handlers.get("file:saveAs")!({}, "content", "untitled.cde");
    expect(fileService.saveAsDialog).toHaveBeenCalledWith("untitled.cde", "content");

    handlers.get("file:export")!({}, "/tmp/out.txt", "data");
    expect(fileService.exportFile).toHaveBeenCalledWith("/tmp/out.txt", "data");

    handlers.get("tecsgen:generate")!({}, ["-c", "main.cde"]);
    expect(tecsgenRunner.run).toHaveBeenCalledWith(["-c", "main.cde"]);

    handlers.get("tecsgen:version")!({});
    expect(tecsgenRunner.version).toHaveBeenCalled();
  });
});

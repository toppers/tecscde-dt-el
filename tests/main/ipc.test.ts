// [[TECSCDE-DT-EL内部仕様]] 第7章7.2節・第9章9.2節 — IPCチャネル名とハンドラの配線を検証する。
// チャネル名の変更は preload 側と暗黙に同期しなければならない契約であるため、
// registerIpcHandlers が正しいチャネル名へ正しいメソッドを結びつけていることを確認する。

import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const clipboardMock = {
  writeText: vi.fn(),
  readText: vi.fn().mockReturnValue("clip-content"),
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      // 実Electronと同様、同じチャネルの二重登録は例外にする。
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for \`${channel}\``);
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
  },
  clipboard: clipboardMock,
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/usr/bin/gcc"] }),
  },
}));

// 第7C章7.7.1節: file:saveSessionはFileServiceを経由せずsaveAppSettingsを直接呼ぶため、
// ここでは実際のfs/app.getPathに触れないようモックする（app-settings.test.tsで別途検証）。
const saveAppSettings = vi.fn().mockResolvedValue(undefined);
const loadAppSettings = vi.fn().mockResolvedValue({});
vi.mock("../../src/main/app-settings.js", () => ({ saveAppSettings, loadAppSettings }));

const { registerIpcHandlers } = await import("../../src/main/ipc.js");

describe("registerIpcHandlers", () => {
  it("rejects malformed command-copy requests before resolving any execution settings", async () => {
    const resolveCommand = vi.fn();
    registerIpcHandlers({} as never, {} as never, {} as never, { resolveCommand } as never);
    const copy = handlers.get("tecsgen:commandLine")!;
    for (const args of [["x"], [1], "bad"]) {
      await expect(copy({}, args, "unknown", undefined)).rejects.toThrow("不正");
    }
    await expect(copy({}, [1], "cmd", undefined)).rejects.toThrow("不正");
    await expect(copy({}, [], "powershell5", 42)).rejects.toThrow("不正");
    expect(resolveCommand).not.toHaveBeenCalled();
  });

  it("formats the current configured executable for the selected shell without executing it", async () => {
    const resolveCommand = vi.fn(async () => ({ executable: process.execPath, args: ["--prefix"], source: "settings" as const }));
    const generate = vi.fn();
    registerIpcHandlers({} as never, { generate } as never, {} as never, { resolveCommand } as never);
    for (const shell of ["powershell7", "powershell5", "cmd"]) {
      const command = await handlers.get("tecsgen:commandLine")!({}, ['quoted "text"', ""], shell, undefined);
      expect(command).toContain("EncodedCommand");
    }
    expect(resolveCommand).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
  });
  it("wires every file:* and tecsgen:* channel to the corresponding service method", async () => {
    const fileService = {
      save: vi.fn().mockResolvedValue(undefined),
      saveWithReceipt: vi.fn().mockResolvedValue({ path: "/tmp/a.cde", writeSequence: 1 }),
      chooseSavePath: vi.fn().mockResolvedValue("saved-path"),
      saveAsDialog: vi.fn().mockResolvedValue("saved-path"),
      exportFile: vi.fn().mockResolvedValue(undefined),
      exportPdf: vi.fn().mockResolvedValue(undefined),
      chooseExportPath: vi.fn().mockResolvedValue("/tmp/out.svg"),
      chooseFolder: vi.fn().mockResolvedValue("/tmp/root"),
      listDirectory: vi.fn().mockResolvedValue([]),
      openPath: vi.fn().mockResolvedValue("open-path-result"),
      confirmDiscardChanges: vi.fn().mockResolvedValue(true),
      resolveImports: vi.fn().mockResolvedValue("resolve-imports-result"),
      parseTecsgenOptionsFile: vi.fn().mockResolvedValue("parsed-options-result"),
    };
    const tecsgenRunner = {
      run: vi.fn().mockResolvedValue("run-result"),
      generate: vi.fn().mockResolvedValue("generate-result"),
      generatedTypes: vi.fn().mockResolvedValue("generated-types-result"),
      preprocess: vi.fn().mockResolvedValue("preprocess-result"),
      version: vi.fn().mockResolvedValue({ kind: "ok", text: "tecsgen  version 1.9.1" }),
    };

    const logService = { append: vi.fn().mockResolvedValue(undefined) };

    registerIpcHandlers(fileService as never, tecsgenRunner as never, logService as never);

    expect([...handlers.keys()].sort()).toEqual(
      [
        "cdl:grammar-assets",
        "clipboard:readText",
        "clipboard:writeText",
        "file:chooseFolder",
        "file:readDefinitionFile",
        "file:planCdlFileLists",
        "file:applyCdlFileLists",
        "file:confirmCdlFileLists",
        "file:chooseSavePath",
        "file:chooseExportPath",
        "file:confirmDiscardChanges",
        "file:export",
        "file:exportPdf",
        "file:listDirectory",
        "file:openPath",
        "file:openPaths",
        "file:parseTecsgenOptionsFile",
        "file:resolveImports",
        "file:save",
        "file:saveAs",
        "file:saveSession",
        "log:append",
        "settings:get",
        "settings:getCdlFilesRoot",
        "settings:setCdlFilesRoot",
        "settings:chooseCdlFilesRoot",
        "settings:getToolSettings",
        "settings:updateToolSettings",
        "settings:getAppInformation",
        "settings:chooseTecsgenPath",
        "settings:chooseCppPath",
        "tecsgen:generate",
        "tecsgen:generatedTypes",
        "tecsgen:preprocess",
        "tecsgen:version",
        "tecsgen:checkPath",
        "tecsgen:commandLine",
      ].sort(),
    );

    handlers.get("file:save")!({}, "/tmp/a.cde", "content");
    expect(fileService.saveWithReceipt).toHaveBeenCalledWith("/tmp/a.cde", "content");

    handlers.get("file:saveAs")!({}, "content", "untitled.cde");
    expect(fileService.saveAsDialog).toHaveBeenCalledWith("untitled.cde", "content");

    handlers.get("file:export")!({}, "/tmp/out.txt", "data");
    expect(fileService.exportFile).toHaveBeenCalledWith("/tmp/out.txt", "data");

    handlers.get("file:chooseExportPath")!({}, "png", "diagram.png");
    expect(fileService.chooseExportPath).toHaveBeenCalledWith("png", "diagram.png");

    const png = Uint8Array.from([137, 80, 78, 71]);
    handlers.get("file:export")!({}, "/tmp/out.png", png);
    expect(fileService.exportFile).toHaveBeenCalledWith("/tmp/out.png", png);

    const page = { kind: "paper", size: "A4", orientation: "LANDSCAPE" };
    handlers.get("file:exportPdf")!({}, "/tmp/out.pdf", "<svg/>", page);
    expect(fileService.exportPdf).toHaveBeenCalledWith("/tmp/out.pdf", "<svg/>", page);

    handlers.get("file:chooseFolder")!({});
    expect(fileService.chooseFolder).toHaveBeenCalled();

    handlers.get("file:listDirectory")!({}, "/tmp/root");
    expect(fileService.listDirectory).toHaveBeenCalledWith("/tmp/root");

    handlers.get("file:openPath")!({}, "/tmp/root/main.cde");
    expect(fileService.openPath).toHaveBeenCalledWith("/tmp/root/main.cde");

    handlers.get("file:confirmDiscardChanges")!({});
    expect(fileService.confirmDiscardChanges).toHaveBeenCalled();

    handlers.get("file:saveSession")!({}, "/tmp/root/main.cde", ["/tmp/root/celltypes.cdl"]);
    expect(saveAppSettings).toHaveBeenCalledWith({
      lastSession: { editablePath: "/tmp/root/main.cde", referencePaths: ["/tmp/root/celltypes.cdl"] },
    });

    handlers.get("file:saveSession")!({}, null, ["/tmp/root/celltypes.cdl"]);
    expect(saveAppSettings).toHaveBeenCalledWith({
      lastSession: { referencePaths: ["/tmp/root/celltypes.cdl"] },
    });

    const requests = [{ kind: "import", specifier: "celltypes.cdl" }];
    const options = { importPaths: ["."] };
    handlers.get("file:resolveImports")!({}, "/tmp/root/main.cde", requests, options);
    expect(fileService.resolveImports).toHaveBeenCalledWith("/tmp/root/main.cde", requests, options);

    handlers.get("file:parseTecsgenOptionsFile")!({}, "/tmp/root/build.tecsgen-opts");
    expect(fileService.parseTecsgenOptionsFile).toHaveBeenCalledWith("/tmp/root/build.tecsgen-opts");

    handlers.get("tecsgen:generate")!({}, ["-c", "main.cde"]);
    expect(tecsgenRunner.generate).toHaveBeenCalledWith(["-c", "main.cde"], undefined);
    handlers.get("tecsgen:generate")!({}, ["-c", "main.cde"], "/tmp/root");
    expect(tecsgenRunner.generate).toHaveBeenCalledWith(["-c", "main.cde"], "/tmp/root");

    handlers.get("tecsgen:generatedTypes")!({}, ["main.cde"], "/tmp/root/main.cde", "/tmp/root/build.tecsgen-opts");
    expect(tecsgenRunner.generatedTypes).toHaveBeenCalledWith(
      ["main.cde"], "/tmp/root/main.cde", "/tmp/root/build.tecsgen-opts",
    );

    handlers.get("tecsgen:preprocess")!({}, "header.h", "gcc -E", ["/inc"]);
    expect(tecsgenRunner.preprocess).toHaveBeenCalledWith("header.h", "gcc -E", ["/inc"]);

    handlers.get("tecsgen:version")!({});
    expect(tecsgenRunner.version).toHaveBeenCalled();

    // 第3章3.2節: 設定が無ければ allowEditSystemDefined は false。true と書かれたときだけ true。
    await expect(handlers.get("settings:get")!({})).resolves.toEqual({ allowEditSystemDefined: false });
    loadAppSettings.mockResolvedValueOnce({ allowEditSystemDefined: true });
    await expect(handlers.get("settings:get")!({})).resolves.toEqual({ allowEditSystemDefined: true });

    handlers.get("log:append")!({}, ["[W-X] a"]);
    expect(logService.append).toHaveBeenCalledWith(["[W-X] a"]);
    logService.append.mockResolvedValueOnce({ newFailure: "EACCES" });
    await expect(handlers.get("log:append")!({}, ["[W-Y] b"])).resolves.toEqual({ newFailure: "EACCES" });

    handlers.get("clipboard:writeText")!({}, "hello");
    expect(clipboardMock.writeText).toHaveBeenCalledWith("hello");

    handlers.get("clipboard:readText")!({});
    expect(clipboardMock.readText).toHaveBeenCalled();

    // settings:chooseCppPath の呼び出し
    const chosen = await handlers.get("settings:chooseCppPath")!({}, "/suggested/path");
    expect(chosen).toBe("/usr/bin/gcc");
  });
  // macOSでウィンドウを閉じてDockから開き直すと createWindow() → registerIpcHandlers() が
  // 2回目に呼ばれる。二重登録で例外にならず、新しいサービスに置き換わること。
  it("can be called again (macOS re-activate) and routes to the newest services", async () => {
    const mk = (tag: string) => ({
      fileService: { saveWithReceipt: vi.fn().mockResolvedValue(tag) },
      tecsgenRunner: {},
      logService: {},
    });
    const first = mk("first");
    const second = mk("second");
    registerIpcHandlers(first.fileService as never, first.tecsgenRunner as never, first.logService as never);
    expect(() =>
      registerIpcHandlers(second.fileService as never, second.tecsgenRunner as never, second.logService as never),
    ).not.toThrow();
    await expect(handlers.get("file:save")!({}, "p", "c")).resolves.toBe("second");
    expect(first.fileService.saveWithReceipt).not.toHaveBeenCalled();
  });
});

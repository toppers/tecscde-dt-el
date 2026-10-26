// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節・第7章7.3節・第9章9.3節・第4章4.1節 —
// renderer側ゲートウェイクラスが window.tecscde を正しく呼び出すことを検証する。
// window.tecscde 自体はここでは手製のスタブで代替する（jsdom等の実DOMは不要）。

import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileGateway } from "../../src/renderer/gateways/file-gateway.js";
import { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway.js";
import { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway.js";
import { LogGateway } from "../../src/renderer/gateways/log-gateway.js";
import { WindowGateway } from "../../src/renderer/gateways/window-gateway.js";
import { SettingsGateway } from "../../src/renderer/gateways/settings-gateway.js";
import type { TecscdeApi } from "../../src/shared/ipc-types.js";

function stubApi(): TecscdeApi {
  return {
    cdl: {
      loadGrammarAssets: vi.fn().mockResolvedValue({ runtimeWasm: new Uint8Array(), cdlWasm: new Uint8Array() }),
    },
    file: {
      save: vi.fn().mockResolvedValue(undefined),
      saveAs: vi.fn().mockResolvedValue(null),
      export: vi.fn().mockResolvedValue(undefined),
      chooseExportPath: vi.fn().mockResolvedValue(null),
      chooseFolder: vi.fn().mockResolvedValue(null),
      listDirectory: vi.fn().mockResolvedValue([]),
      openPath: vi.fn().mockResolvedValue({ editable: { path: "x.cde", content: "" }, references: [] }),
      confirmDiscardChanges: vi.fn().mockResolvedValue(true),
      saveSession: vi.fn().mockResolvedValue(undefined),
      resolveImports: vi.fn().mockResolvedValue([]),
      parseTecsgenOptionsFile: vi.fn().mockResolvedValue({ cdlFiles: [], importPaths: [], defineMacros: [] }),
    },
    tecsgen: {
      generate: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, executableFound: true }),
      generatedTypes: vi.fn().mockResolvedValue({
        result: { stdout: "", stderr: "", exitCode: 0, executableFound: true }, sources: [],
      }),
      preprocess: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, executableFound: true }),
      version: vi.fn().mockResolvedValue({ kind: "not-found" }),
    },
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn().mockReturnValue(""),
    },
    settings: {
      get: vi.fn().mockResolvedValue({ allowEditSystemDefined: false }),
    },
    window: {
      setDirty: vi.fn(),
    },
    log: {
      append: vi.fn().mockResolvedValue(undefined),
    },
    onBootstrap: vi.fn(),
    onRestoreFileBrowserRoot: vi.fn(),
  };
}

beforeEach(() => {
  (globalThis as { window?: { tecscde: TecscdeApi } }).window = { tecscde: stubApi() };
});

describe("FileGateway", () => {
  it("delegates every method to window.tecscde.file", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    const gateway = new FileGateway();

    gateway.save("/a.cde", "x");
    expect(api.file.save).toHaveBeenCalledWith("/a.cde", "x");

    gateway.saveAs("x", "untitled.cde");
    expect(api.file.saveAs).toHaveBeenCalledWith("x", "untitled.cde");

    gateway.export("/out.txt", "x");
    expect(api.file.export).toHaveBeenCalledWith("/out.txt", "x");

    gateway.chooseExportPath("diagram.svg");
    expect(api.file.chooseExportPath).toHaveBeenCalledWith("diagram.svg");

    gateway.chooseFolder();
    expect(api.file.chooseFolder).toHaveBeenCalled();

    gateway.listDirectory("/root");
    expect(api.file.listDirectory).toHaveBeenCalledWith("/root");

    gateway.openPath("/root/main.cde");
    expect(api.file.openPath).toHaveBeenCalledWith("/root/main.cde");

    gateway.confirmDiscardChanges();
    expect(api.file.confirmDiscardChanges).toHaveBeenCalled();

    gateway.saveSession("/root/main.cde", ["/root/celltypes.cdl"]);
    expect(api.file.saveSession).toHaveBeenCalledWith("/root/main.cde", ["/root/celltypes.cdl"]);

    gateway.saveSession("/root/main.cde", ["/root/celltypes.cdl"], ["/root/include"]);
    expect(api.file.saveSession).toHaveBeenCalledWith("/root/main.cde", ["/root/celltypes.cdl"], ["/root/include"]);

    const requests = [{ kind: "import" as const, specifier: "celltypes.cdl" }];
    const options = { importPaths: ["."] };
    gateway.resolveImports("/root/main.cde", requests, options);
    expect(api.file.resolveImports).toHaveBeenCalledWith("/root/main.cde", requests, options);

    gateway.parseTecsgenOptionsFile("/root/build.tecsgen-opts");
    expect(api.file.parseTecsgenOptionsFile).toHaveBeenCalledWith("/root/build.tecsgen-opts");

    const listener = vi.fn();
    gateway.onRestoreFileBrowserRoot(listener);
    expect(api.onRestoreFileBrowserRoot).toHaveBeenCalledWith(listener);
  });
});

describe("TecsgenGateway", () => {
  it("delegates to window.tecscde.tecsgen", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    const gateway = new TecsgenGateway();

    gateway.generate(["-c", "main.cde"]);
    expect(api.tecsgen.generate).toHaveBeenCalledWith(["-c", "main.cde"]);
    gateway.generate(["-c", "main.cde"], "/root");
    expect(api.tecsgen.generate).toHaveBeenCalledWith(["-c", "main.cde"], "/root");

    gateway.preprocess("header.h", "gcc -E", ["/inc"]);
    expect(api.tecsgen.preprocess).toHaveBeenCalledWith("header.h", "gcc -E", ["/inc"]);

    gateway.version();
    expect(api.tecsgen.version).toHaveBeenCalled();
  });
});

describe("LogGateway", () => {
  it("delegates to window.tecscde.log", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;

    new LogGateway().append(["[W-X] a"]);

    expect(api.log.append).toHaveBeenCalledWith(["[W-X] a"]);
  });
});

describe("ClipboardGateway", () => {
  it("delegates to window.tecscde.clipboard without going through ipcMain (2.4節)", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    const gateway = new ClipboardGateway();

    gateway.writeText("hello");
    expect(api.clipboard.writeText).toHaveBeenCalledWith("hello");

    gateway.readText();
    expect(api.clipboard.readText).toHaveBeenCalled();
  });
});

describe("WindowGateway", () => {
  it("delegates setDirty to window.tecscde.window", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    new WindowGateway().setDirty(true);
    expect(api.window.setDirty).toHaveBeenCalledWith(true);
  });
});

describe("SettingsGateway", () => {
  it("delegates get to window.tecscde.settings", async () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    await expect(new SettingsGateway().get()).resolves.toEqual({ allowEditSystemDefined: false });
    expect(api.settings.get).toHaveBeenCalled();
  });
});

// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節・第7章7.3節・第9章9.3節・第4章4.1節 —
// renderer側ゲートウェイクラスが window.tecscde を正しく呼び出すことを検証する。
// window.tecscde 自体はここでは手製のスタブで代替する（jsdom等の実DOMは不要）。

import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileGateway } from "../../src/renderer/gateways/file-gateway.js";
import { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway.js";
import { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway.js";
import type { TecscdeApi } from "../../src/shared/ipc-types.js";

function stubApi(): TecscdeApi {
  return {
    cdl: {
      loadGrammarAssets: vi.fn().mockResolvedValue({ runtimeWasm: new Uint8Array(), cdlWasm: new Uint8Array() }),
    },
    file: {
      open: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      saveAs: vi.fn().mockResolvedValue(null),
      export: vi.fn().mockResolvedValue(undefined),
    },
    tecsgen: {
      generate: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, executableFound: true }),
      version: vi.fn().mockResolvedValue(null),
    },
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn().mockReturnValue(""),
    },
    onBootstrap: vi.fn(),
  };
}

beforeEach(() => {
  (globalThis as { window?: { tecscde: TecscdeApi } }).window = { tecscde: stubApi() };
});

describe("FileGateway", () => {
  it("delegates every method to window.tecscde.file", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    const gateway = new FileGateway();

    gateway.open();
    expect(api.file.open).toHaveBeenCalled();

    gateway.save("/a.cde", "x");
    expect(api.file.save).toHaveBeenCalledWith("/a.cde", "x");

    gateway.saveAs("x", "untitled.cde");
    expect(api.file.saveAs).toHaveBeenCalledWith("x", "untitled.cde");

    gateway.export("/out.txt", "x");
    expect(api.file.export).toHaveBeenCalledWith("/out.txt", "x");
  });
});

describe("TecsgenGateway", () => {
  it("delegates to window.tecscde.tecsgen", () => {
    const api = (globalThis as unknown as { window: { tecscde: TecscdeApi } }).window.tecscde;
    const gateway = new TecsgenGateway();

    gateway.generate(["-c", "main.cde"]);
    expect(api.tecsgen.generate).toHaveBeenCalledWith(["-c", "main.cde"]);

    gateway.version();
    expect(api.tecsgen.version).toHaveBeenCalled();
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

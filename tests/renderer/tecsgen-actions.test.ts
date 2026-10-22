// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節 — `generate()`/`tecsgenCommandLine()`のヘッドレステスト。
// DOM経由の配線（ツールバーのdisabled状態等）はtests/renderer/shell.dom.test.tsで検証する。

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { generate, tecsgenCommandLine } from "../../src/renderer/app/tecsgen-actions";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { asCellId } from "../../src/renderer/model/ids";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { TecsgenResult } from "../../src/shared/ipc-types";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const noopFileGateway = { open: async () => null, save: async () => undefined, saveAs: async () => null, export: async () => undefined } as unknown as FileGateway;

function fakeTecsgenGateway(result: Partial<TecsgenResult> = {}): { gateway: TecsgenGateway; calls: string[][]; cwds: Array<string | undefined> } {
  const calls: string[][] = [];
  const cwds: Array<string | undefined> = [];
  const gateway = {
    generate: (args: readonly string[], cwd?: string) => {
      calls.push([...args]);
      cwds.push(cwd);
      return Promise.resolve<TecsgenResult>({ stdout: "", stderr: "", exitCode: 0, executableFound: true, ...result });
    },
    version: () => Promise.resolve(null),
  } as unknown as TecsgenGateway;
  return { gateway, calls, cwds };
}

describe("generate", () => {
  it("does nothing when the store has no file path yet", async () => {
    const store = new AppStore(loadDoc());
    const tecsgen = fakeTecsgenGateway();

    await generate(store, noopFileGateway, tecsgen.gateway);

    expect(tecsgen.calls).toEqual([]);
  });

  it("does nothing (re-entrantly) while already generating", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    store.setGenerating(true);
    const tecsgen = fakeTecsgenGateway();

    await generate(store, noopFileGateway, tecsgen.gateway);

    expect(tecsgen.calls).toEqual([]);
  });

  it("passes reference file paths, tool-info, and the editing path through to the gateway", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde", [], ["/proj/celltypes.cdl"]);
    const tecsgen = fakeTecsgenGateway();

    await generate(store, noopFileGateway, tecsgen.gateway);

    expect(tecsgen.calls).toHaveLength(1);
    const args = tecsgen.calls[0]!;
    expect(args).toContain("-I");
    expect(args).toContain("./include"); // sample's __tool_info__("tecsgen").import_path
    expect(args).not.toContain("E:/example/project"); // base_dir must never reach the CLI（8.4.2）
    expect(args).toContain("/proj/celltypes.cdl");
    expect(args[args.length - 1]).toBe("/proj/main.cde");
  });

  it("resets isGenerating to false after completion, even though the promise already resolved", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    const tecsgen = fakeTecsgenGateway();

    await generate(store, noopFileGateway, tecsgen.gateway);

    expect(store.isGenerating).toBe(false);
  });

  it("stores the parsed diagnostics from the result via setTecsgenDiagnostics", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    const tecsgen = fakeTecsgenGateway({ executableFound: false });

    await generate(store, noopFileGateway, tecsgen.gateway);

    expect(store.getReport().errorCount).toBe(1);
  });

  it("auto-saves dirty content via file-actions.save() before generating", async () => {
    const saveCalls: Array<[string, string]> = [];
    const fileGateway = {
      open: async () => null,
      save: async (path: string, content: string) => {
        saveCalls.push([path, content]);
      },
      saveAs: async () => null,
      export: async () => undefined,
    } as unknown as FileGateway;
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    store.dispatch(new MoveCellsCommand([asCellId("cController1")], 1, 0));
    expect(store.isDirty()).toBe(true);
    const tecsgen = fakeTecsgenGateway();

    await generate(store, fileGateway, tecsgen.gateway);

    expect(saveCalls).toHaveLength(1);
    expect(store.isDirty()).toBe(false);
    expect(tecsgen.calls).toHaveLength(1);
  });
});

describe("tecsgenCommandLine", () => {
  it("returns undefined when no file has been loaded", async () => {
    const store = new AppStore(loadDoc());
    expect(await tecsgenCommandLine(store, noopFileGateway)).toBeUndefined();
  });

  it("builds the display command line from the same inputs as generate()", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde", [], ["/proj/celltypes.cdl"]);

    const line = await tecsgenCommandLine(store, noopFileGateway);

    expect(line).toMatch(/^tecsgen /);
    expect(line).toContain("/proj/celltypes.cdl");
    expect(line?.endsWith("/proj/main.cde")).toBe(true);
  });
});

describe("tecsgen-opts options are passed to tecsgen (外部仕様8.4.2)", () => {
  function storeWithOptionsFile(): AppStore {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde", [], [], new Map(), ["/extra"], "/proj/build.tecsgen-opts");
    return store;
  }
  const optionsGateway = (options: unknown) =>
    ({ parseTecsgenOptionsFile: async () => options }) as unknown as FileGateway;

  it("appends -I and -D from the options file, and prefers its -c", async () => {
    const store = storeWithOptionsFile();
    const tecsgen = fakeTecsgenGateway();
    await generate(store, optionsGateway({ cdlFiles: [], importPaths: ["/inc1", "/inc2"], cpp: "clang -E", defineMacros: ["A=1", "B"] }), tecsgen.gateway);
    const args = tecsgen.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["-I", "/inc1", "-I", "/inc2", "-D", "A=1", "-D", "B", "-c", "clang -E"]));
    expect(args.indexOf("/inc1")).toBeLessThan(args.indexOf("/inc2"));
    expect(args.at(-1)).toBe("/proj/main.cde");
  });

  it("uses the same inputs for the copied command line", async () => {
    const store = storeWithOptionsFile();
    const line = await tecsgenCommandLine(store, optionsGateway({ cdlFiles: [], importPaths: [], cpp: "gcc", defineMacros: ["X=1"] }));
    expect(line).toContain("-D X=1");
    expect(line).toContain("-c gcc");
  });

  it("starts tecsgen in the directory of the options file so relative -I/-S keep their base (外部仕様5.3節)", async () => {
    const store = storeWithOptionsFile();
    const tecsgen = fakeTecsgenGateway();
    await generate(store, optionsGateway({ cdlFiles: [], importPaths: ["./inc"], defineMacros: [], systemDirs: [] }), tecsgen.gateway);
    expect(tecsgen.cwds).toEqual(["/proj"]);
    expect(tecsgen.calls[0]).toEqual(expect.arrayContaining(["-I", "./inc"]));
  });

  it("still starts in the options file directory when parsing fails", async () => {
    const store = storeWithOptionsFile();
    const tecsgen = fakeTecsgenGateway();
    const failing = { parseTecsgenOptionsFile: async () => { throw new Error("gone"); } } as unknown as FileGateway;
    await generate(store, failing, tecsgen.gateway);
    expect(tecsgen.cwds).toEqual(["/proj"]);
  });

  it("does not set a working directory when no options file was opened", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    const tecsgen = fakeTecsgenGateway();
    await generate(store, noopFileGateway, tecsgen.gateway);
    expect(tecsgen.cwds).toEqual([undefined]);
  });

  it("falls back to the __tool_info__ values when the options file cannot be parsed", async () => {
    const store = storeWithOptionsFile();
    const tecsgen = fakeTecsgenGateway();
    const failing = { parseTecsgenOptionsFile: async () => { throw new Error("gone"); } } as unknown as FileGateway;
    await generate(store, failing, tecsgen.gateway);
    expect(tecsgen.calls).toHaveLength(1);
    expect(tecsgen.calls[0]).not.toContain("-D");
  });

  it("does not touch the options file when none was opened", async () => {
    const store = new AppStore(loadDoc());
    store.loadDocument(loadDoc(), "/proj/main.cde");
    const parse = vi.fn();
    const tecsgen = fakeTecsgenGateway();
    await generate(store, { parseTecsgenOptionsFile: parse } as unknown as FileGateway, tecsgen.gateway);
    expect(parse).not.toHaveBeenCalled();
  });
});

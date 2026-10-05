// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.4節・第7E章7.5.4〜7.5.5節 — `resolveAllImports`の
// renderer側オーケストレーション（推移的closure・循環/重複抑止・import_Cの除外）を検証する。
// `FileGateway.resolveImports`はフェイクに置き換える——探索アルゴリズム自体（searchDirs×
// importPaths）は`tests/main/file-service.test.ts`が検証済みのため、ここでは
// 「1件の解決結果をどう扱うか」だけをテスト範囲とする。

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveAddedReference, resolveAllImports } from "../../src/renderer/app/import-resolution";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import { CdlDocumentLoader, type CdlSource } from "../../src/renderer/cdl/document-builder";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { FileService } from "../../src/main/file-service.js";
import { FileGateway } from "../../src/renderer/gateways/file-gateway.js";
import { AppStore } from "../../src/renderer/app/store.js";
import { applyOpenResult } from "../../src/renderer/app/file-actions.js";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { CppResult, ImportResolutionOptions } from "../../src/shared/ipc-types.js";
import type { ImportRequest } from "../../src/shared/ipc-types.js";

interface FakeFile {
  readonly canonicalPath: string;
  readonly content: string;
}

/** specifier → 解決結果の対応表からフェイクの `FileGateway.resolveImports` を作る。 */
function fakeGateway(files: Readonly<Record<string, FakeFile>>): { gateway: FileGateway; calls: ImportRequest[][] } {
  const calls: ImportRequest[][] = [];
  const resolveImports = vi.fn(async (_editablePath: string, requests: readonly ImportRequest[]) => {
    calls.push([...requests]);
    return requests.map((request) => {
      const file = files[request.specifier];
      if (!file) return { request, error: "not-found" as const };
      return { request, canonicalPath: file.canonicalPath, content: file.content };
    });
  });
  return { gateway: { resolveImports } as unknown as FileGateway, calls };
}

/**
 * フェイクの `TecsgenGateway`。既定は「プリプロセッサが見つからない」（executableFound:
 * false）——大半のテストは`import_C`を使わないため呼ばれないが、呼ばれた場合でも
 * 常にフォールバック経路（生テキストのまま`CdeclExtractor`へ渡す）になる。
 * 9B章9B.6の呼び出し先。
 */
function fakeTecsgenGateway(preprocessResult: Partial<CppResult> = {}): TecsgenGateway {
  const preprocess = vi.fn(
    async (): Promise<CppResult> => ({
      stdout: "",
      stderr: "",
      exitCode: null,
      executableFound: false,
      ...preprocessResult,
    }),
  );
  return { preprocess } as unknown as TecsgenGateway;
}

const toolInfo = emptyToolInfoTecsgen();
const tecsgenGateway = fakeTecsgenGateway();

describe("resolveAllImports", () => {
  it("resolves a single import and adds it as a reference", async () => {
    const { gateway } = fakeGateway({ "B.cdl": { canonicalPath: "/root/B.cdl", content: "" } });

    const { references, diagnostics } = await resolveAllImports(
      gateway,
      tecsgenGateway,
      "/root/A.cdl",
      'import("B.cdl");',
      toolInfo,
    );

    expect(references).toEqual([{ path: "/root/B.cdl", content: "" }]);
    expect(diagnostics).toEqual([]);
  });

  it("resolves recursively across a transitive closure (A imports B imports C)", async () => {
    const { gateway } = fakeGateway({
      "B.cdl": { canonicalPath: "/root/B.cdl", content: 'import("C.cdl");' },
      "C.cdl": { canonicalPath: "/root/C.cdl", content: "" },
    });

    const { references } = await resolveAllImports(gateway, tecsgenGateway, "/root/A.cdl", 'import("B.cdl");', toolInfo);

    expect(references.map((r) => r.path)).toEqual(["/root/B.cdl", "/root/C.cdl"]);
  });

  it("does not loop forever on an import cycle, and never adds the editable file itself as a reference", async () => {
    const editablePath = "/root/A.cdl";
    const { gateway, calls } = fakeGateway({
      "A.cdl": { canonicalPath: editablePath, content: "unused" }, // B が import("A.cdl") で参照し返す
      "B.cdl": { canonicalPath: "/root/B.cdl", content: 'import("A.cdl");' },
    });

    const { references, diagnostics } = await resolveAllImports(
      gateway,
      tecsgenGateway,
      editablePath,
      'import("B.cdl");',
      toolInfo,
    );

    expect(references.map((r) => r.path)).toEqual(["/root/B.cdl"]); // A自身は含まれない
    expect(diagnostics).toEqual([]);
    expect(calls.length).toBe(2); // 1周目: B。2周目: Aのみ（既に解決済みなので3周目は発生しない）
  });

  it("deduplicates when two different specifiers resolve to the same canonical path", async () => {
    const { gateway } = fakeGateway({
      "b.cdl": { canonicalPath: "/root/B.cdl", content: "" },
      "alias_b.cdl": { canonicalPath: "/root/B.cdl", content: "" },
    });

    const { references } = await resolveAllImports(
      gateway,
      tecsgenGateway,
      "/root/A.cdl",
      'import("b.cdl");\nimport("alias_b.cdl");',
      toolInfo,
    );

    expect(references).toEqual([{ path: "/root/B.cdl", content: "" }]);
  });

  it("emits W-UNRESOLVED-REF-FILE for an unresolved import, without throwing (第7E章7.5.6節)", async () => {
    const { gateway } = fakeGateway({});

    const { references, diagnostics } = await resolveAllImports(
      gateway,
      tecsgenGateway,
      "/root/A.cdl",
      'import("missing.cdl");',
      toolInfo,
    );

    expect(references).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "warning", code: W_CODES.UNRESOLVED_REF_FILE });
  });

  it("resolves import_C but neither adds it to references nor recurses into its content (第7E章7.5.5節)", async () => {
    const { gateway, calls } = fakeGateway({
      "foo.h": { canonicalPath: "/root/foo.h", content: 'import("should-not-be-fetched.cdl");' },
    });

    const { references, diagnostics, cdeclResults } = await resolveAllImports(
      gateway,
      tecsgenGateway, // 既定はプリプロセッサ未検出 → フォールバック経路
      "/root/A.cdl",
      'import_C("foo.h");',
      toolInfo,
    );

    expect(references).toEqual([]);
    expect(calls).toHaveLength(1); // foo.hの内容から抽出されたimportで2周目が発生していない
    // フォールバック経路を通ったため W-CPP-FALLBACK が1件出る（9B章9B.6）。
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "warning", code: W_CODES.CPP_FALLBACK });
    // foo.hの内容はCDL文のため typedef/struct は0件——CdeclExtractor自体は呼ばれている。
    expect(cdeclResults.get("/root/foo.h")).toEqual({ typedefs: new Map(), structs: new Map(), hasErrors: false });
  });

  it("extracts typedefs from import_C via the preprocessor when it succeeds (9B章9B.6)", async () => {
    const { gateway } = fakeGateway({
      "foo.h": { canonicalPath: "/root/foo.h", content: "/* raw, unused when preprocess succeeds */" },
    });
    const gatewayWithCpp = fakeTecsgenGateway({
      executableFound: true,
      exitCode: 0,
      stdout: "typedef unsigned char uint8_t;",
    });

    const { diagnostics, cdeclResults } = await resolveAllImports(
      gateway,
      gatewayWithCpp,
      "/root/A.cdl",
      'import_C("foo.h");',
      toolInfo,
    );

    expect(diagnostics).toEqual([]); // プリプロセッサ成功時はフォールバック診断が出ない
    expect(cdeclResults.get("/root/foo.h")?.typedefs.get("uint8_t")).toEqual({ kind: "primitive", name: "char" });
  });

  it("emits W-CDECL-PARSE when the (fallback) header text has a syntax error, without throwing", async () => {
    const { gateway } = fakeGateway({
      "foo.h": { canonicalPath: "/root/foo.h", content: "typedef int MyInt; struct Broken { int x" },
    });

    const { diagnostics, cdeclResults } = await resolveAllImports(
      gateway,
      tecsgenGateway,
      "/root/A.cdl",
      'import_C("foo.h");',
      toolInfo,
    );

    expect(diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([W_CODES.CPP_FALLBACK, W_CODES.CDECL_PARSE_ERROR]),
    );
    expect(cdeclResults.get("/root/foo.h")?.typedefs.get("MyInt")).toEqual({ kind: "primitive", name: "int" });
  });

  it("passes toolInfo.baseDir/importPath through to the gateway as ImportResolutionOptions", async () => {
    const { gateway } = fakeGateway({ "B.cdl": { canonicalPath: "/root/B.cdl", content: "" } });
    const resolveImportsSpy = gateway.resolveImports as unknown as ReturnType<typeof vi.fn>;

    await resolveAllImports(gateway, tecsgenGateway, "/root/A.cdl", 'import("B.cdl");', {
      ...toolInfo,
      baseDir: "/some/base",
      importPath: [".", "include"],
    });

    expect(resolveImportsSpy).toHaveBeenCalledWith(
      "/root/A.cdl",
      [{ kind: "import", specifier: "B.cdl" }],
      { baseDir: "/some/base", importPaths: [".", "include"], extraSearchDirs: [] },
    );
  });

  it("appends extraImportPaths after toolInfo.importPath (第7C章7.7.4節③、#10)", async () => {
    const { gateway } = fakeGateway({ "B.cdl": { canonicalPath: "/root/B.cdl", content: "" } });
    const resolveImportsSpy = gateway.resolveImports as unknown as ReturnType<typeof vi.fn>;

    await resolveAllImports(gateway, tecsgenGateway, "/root/A.cdl", 'import("B.cdl");', { ...toolInfo, importPath: ["."] }, [
      "./opts-dir",
    ]);

    expect(resolveImportsSpy).toHaveBeenCalledWith(
      "/root/A.cdl",
      [{ kind: "import", specifier: "B.cdl" }],
      { baseDir: undefined, importPaths: [".", "./opts-dir"], extraSearchDirs: [] },
    );
  });
});

describe("resolveAddedReference", () => {
  it("resolves a manually-added file and its own recursive imports (第7C章7.7.2節)", async () => {
    const { gateway } = fakeGateway({
      "/root/extra.cdl": { canonicalPath: "/root/extra.cdl", content: 'import("nested.cdl");' },
      "nested.cdl": { canonicalPath: "/root/nested.cdl", content: "" },
    });

    const { references, diagnostics } = await resolveAddedReference(
      gateway,
      tecsgenGateway,
      "/root/A.cdl",
      toolInfo,
      "/root/extra.cdl",
      [],
    );

    expect(references.map((r) => r.path)).toEqual(["/root/extra.cdl", "/root/nested.cdl"]);
    expect(diagnostics).toEqual([]);
  });

  it("returns no references when the path is already loaded (#8 重複判定)", async () => {
    const { gateway, calls } = fakeGateway({
      "/root/extra.cdl": { canonicalPath: "/root/extra.cdl", content: "" },
    });

    const { references } = await resolveAddedReference(gateway, tecsgenGateway, "/root/A.cdl", toolInfo, "/root/extra.cdl", [
      "/root/extra.cdl", // すでに読み込み済み
    ]);

    expect(references).toEqual([]);
    expect(calls[0]).toEqual([{ kind: "manual", specifier: "/root/extra.cdl" }]); // 呼び出し自体は行うが結果は種付けで除外される
  });

  it("issues the initial request with kind:'manual'", async () => {
    const { gateway, calls } = fakeGateway({ "/root/extra.cdl": { canonicalPath: "/root/extra.cdl", content: "" } });

    await resolveAddedReference(gateway, tecsgenGateway, "/root/A.cdl", toolInfo, "/root/extra.cdl", []);

    expect(calls[0]).toEqual([{ kind: "manual", specifier: "/root/extra.cdl" }]);
  });
});

describe("tEV3Sample.tecsgen-opts real resolution", () => {
  it("loads tEV3Sample.tecsgen-opts and resolves all imported CDL files transitively", async () => {
    const optsPath = resolve("hr-tecs/workspace/sd/tEV3Sample.tecsgen-opts");
    const fileService = new FileService({} as never);
    const parsed = await fileService.parseTecsgenOptionsFile(optsPath);

    expect(parsed.cdlFiles).toHaveLength(1);
    const editablePath = parsed.cdlFiles[0]!;
    expect(editablePath).toBe(resolve("hr-tecs/workspace/sd/tEV3Sample.cdl"));

    const editableContent = readFileSync(editablePath, "utf-8");
    const realGateway = {
      resolveImports: (path: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
        fileService.resolveImports(path, requests, options),
    } as unknown as FileGateway;

    const { references, diagnostics } = await resolveAllImports(
      realGateway,
      tecsgenGateway,
      editablePath,
      editableContent,
      emptyToolInfoTecsgen(),
      parsed.importPaths,
    );

    expect(diagnostics.filter((d) => d.code === W_CODES.UNRESOLVED_REF_FILE)).toEqual([]);
    expect(references.length).toBeGreaterThan(0);
    const resolvedPaths = references.map((r) => r.path);
    // Directly imported
    expect(resolvedPaths).toContain(resolve("hr-tecs/workspace/sd/VM1.cdl"));
    // Transitively imported from VM1.cdl
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/EV3_common.cdl"));
    // Transitively imported from EV3_common.cdl
    expect(resolvedPaths).toContain(resolve("hr-tecs/include/kernel.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecsgen/tecsgen/tecs/mruby/tMruby.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tUltrasonicSensor.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tColorSensor.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tTouchSensor.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tGyroSensor.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tMotor.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tLCD.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tLED.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tButton.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tBattery.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tSpeaker.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tEV3Platform.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/mindstorms_ev3/tBalancer.cdl"));
    expect(resolvedPaths).toContain(resolve("hr-tecs/tecs_lib/common/tSharedMemory.cdl"));
  });

  it("parses CDL files from tEV3Sample.tecsgen-opts and verifies cells, celltypes, and joins in TecscdeDocument", async () => {
    const optsPath = resolve("hr-tecs/workspace/sd/tEV3Sample.tecsgen-opts");
    const fileService = new FileService({} as never);
    const parsed = await fileService.parseTecsgenOptionsFile(optsPath);

    const editablePath = parsed.cdlFiles[0]!;
    const editableContent = readFileSync(editablePath, "utf-8");
    const realGateway = {
      resolveImports: (path: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
        fileService.resolveImports(path, requests, options),
    } as unknown as FileGateway;

    const { references } = await resolveAllImports(
      realGateway,
      tecsgenGateway,
      editablePath,
      editableContent,
      emptyToolInfoTecsgen(),
      parsed.importPaths,
    );

    const sources: CdlSource[] = [
      ...references.map((r) => ({ text: r.content, fileName: r.path.replace(/.*[\\/]/, ""), editable: false })),
      { text: editableContent, fileName: editablePath.replace(/.*[\\/]/, ""), editable: true },
    ];

    const { document, diagnostics } = CdlDocumentLoader.loadSources(sources);

    // セル数・セルタイプの検証（参照先CDLも含め全60セル）
    expect(document.cellCount).toBe(60);

    // セル Mruby (セルタイプ: nMruby::tMruby [composite], リージョン: ::rDomainEV3)
    const mrubyCell = document.getCell(asCellId("Mruby"));
    expect(mrubyCell).toBeDefined();
    expect(mrubyCell?.name).toBe("Mruby");
    expect(mrubyCell?.celltypeName).toBe("nMruby::tMruby");
    expect(document.regions.findById(mrubyCell!.regionId)?.namespacePath).toBe("::rDomainEV3");
    expect(mrubyCell?.attrs["mrubyFile"]).toBeDefined();

    // セル MrubyTask1 (セルタイプ: tTask, リージョン: ::rDomainEV3)
    const taskCell = document.getCell(asCellId("MrubyTask1"));
    expect(taskCell).toBeDefined();
    expect(taskCell?.name).toBe("MrubyTask1");
    expect(taskCell?.celltypeName).toBe("tTask");
    expect(taskCell?.celltypeUnresolved).toBe(false);
    expect(document.regions.findById(taskCell!.regionId)?.namespacePath).toBe("::rDomainEV3");
    expect(taskCell?.cports.find((p) => p.name === "cBody")).toBeDefined();
    expect(taskCell?.eports.find((p) => p.name === "eTask")).toBeDefined();
    expect(taskCell?.attrs["taskAttribute"]).toBe('C_EXP("TA_ACT")');
    expect(taskCell?.attrs["priority"]).toBe('C_EXP("EV3_MRUBY_VM_PRIORITY")');
    expect(taskCell?.attrs["systemStackSize"]).toBe('C_EXP("MRUBY_VM_STACK_SIZE")');

    // The composite interface is resolved, so the unsupported warning is absent.
    expect(diagnostics.some((d) => d.code === W_CODES.COMPOSITE_UNSUPPORTED)).toBe(false);
    expect(document.getCelltype("nMruby::tMruby")?.eportTemplates.map((port) => port.name)).toContain("eMrubyBody");
    const composite = document.getCelltype("nMruby::tMruby")?.composite;
    expect(composite?.internalCells.map((cell) => cell.name)).toEqual(["MrubyVM", "MrubyTaskBody", "TLSFMalloc"]);
    expect(composite?.internalCells[0]?.bindings.some((binding) => binding.kind === "external" && binding.name === "cInit")).toBe(true);
    expect(composite?.portExports).toEqual([
      expect.objectContaining({ externalPortName: "eMrubyBody", cellName: "MrubyTaskBody", portName: "eMrubyBody" }),
    ]);
    const bridgeKernel = document.getCell(asCellId("BridgeKernel"));
    expect(bridgeKernel?.celltypeUnresolved).toBe(false);
    expect(bridgeKernel?.cports.map((port) => port.name)).toContain("cTECS");
    const bridgeJoin = document.getJoin(asJoinId("BridgeKernel.cTECS"));
    expect(bridgeJoin?.eportCellId).toBe(asCellId("HRP2Kernel"));
    expect(bridgeJoin?.eportName).toBe("eKernel");
    expect(diagnostics.filter((item) => item.code === W_CODES.UNRESOLVED_CELLTYPE && item.relatedCellId === bridgeKernel?.id)).toEqual([]);

    // セルタイプ一覧の検証
    expect(document.celltypeCount).toBeGreaterThan(10);
    const celltypes = document.celltypeValues().map((ct) => ct.name);
    expect(celltypes).toContain("tMrubyVM");
    expect(celltypes).toContain("tMrubyTaskBody");
    expect(celltypes).toContain("tTask");
    expect(celltypes).toContain("tKernel");
    expect(celltypes).toContain("tMotor");
    expect(celltypes).toContain("tLCD");
    expect(celltypes).toContain("tLED");
    expect(celltypes).toContain("tButton");
    expect(celltypes).toContain("tBattery");
    expect(celltypes).toContain("tSpeaker");
    expect(celltypes).toContain("tUltrasonicSensor");
    expect(celltypes).toContain("tGyroSensor");
    expect(celltypes).toContain("tColorSensor");
    expect(celltypes).toContain("tTouchSensor");
    expect(celltypes).toContain("tBalancer");
    expect(celltypes).toContain("tSharedMemory");

    // セルタイプのポート定義の検証
    const taskCelltype = document.getCelltype("tTask");
    expect(taskCelltype).toBeDefined();
    expect(taskCelltype?.cportTemplates.find((p) => p.name === "cBody")).toBeDefined();
    expect(taskCelltype?.eportTemplates.find((p) => p.name === "eTask")).toBeDefined();

    // 結合（セル間の接続）の検証
    expect(document.joinCount).toBe(31);
    const compositeJoin = document.getJoin(asJoinId("MrubyTask1.cBody"));
    expect(compositeJoin?.eportCellId).toBe(asCellId("Mruby"));
    expect(compositeJoin?.eportName).toBe("eMrubyBody");

    // 結合 1: LCD.cButton -> Button.eButton
    const lcdJoin = document.getJoin(asJoinId("LCD.cButton"));
    expect(lcdJoin).toBeDefined();
    expect(lcdJoin?.cellId).toBe(asCellId("LCD"));
    expect(lcdJoin?.cportName).toBe("cButton");
    expect(lcdJoin?.eportCellId).toBe(asCellId("Button"));
    expect(lcdJoin?.eportName).toBe("eButton");
    expect(lcdJoin?.bars.length).toBeGreaterThan(0);

    // 結合 2: EV3Task.cBody -> EV3Platform.eTaskBody
    const taskJoin = document.getJoin(asJoinId("EV3Task.cBody"));
    expect(taskJoin).toBeDefined();
    expect(taskJoin?.cellId).toBe(asCellId("EV3Task"));
    expect(taskJoin?.cportName).toBe("cBody");
    expect(taskJoin?.eportCellId).toBe(asCellId("EV3Platform"));
    expect(taskJoin?.eportName).toBe("eTaskBody");
    expect(taskJoin?.bars.length).toBeGreaterThan(0);

    // セル側ポートへの結合ID逆参照の検証
    const lcdCell = document.getCell(asCellId("LCD"));
    expect(lcdCell?.cports.find((p) => p.name === "cButton")?.joinId).toBe(asJoinId("LCD.cButton"));
    const buttonCell = document.getCell(asCellId("Button"));
    expect(buttonCell?.eports.find((p) => p.name === "eButton")?.joinIds).toContain(asJoinId("LCD.cButton"));

    const ev3TaskCell = document.getCell(asCellId("EV3Task"));
    expect(ev3TaskCell?.cports.find((p) => p.name === "cBody")?.joinId).toBe(asJoinId("EV3Task.cBody"));
    const platformCell = document.getCell(asCellId("EV3Platform"));
    expect(platformCell?.eports.find((p) => p.name === "eTaskBody")?.joinIds).toContain(asJoinId("EV3Task.cBody"));
  });

  it("resolves all imports without warnings when restoring session from referencePaths (no extraImportPaths)", async () => {
    const fileService = new FileService({} as unknown as Electron.BrowserWindow);
    const optsPath = join(process.cwd(), "hr-tecs", "workspace", "sd", "tEV3Sample.tecsgen-opts");
    const parsed = await fileService.parseTecsgenOptionsFile(optsPath);

    const editablePath = parsed.cdlFiles[0]!;
    const editableContent = readFileSync(editablePath, "utf-8");

    // 1回目のセッション（オプションファイルから開いて全参照を解決）
    const initialGateway = {
      resolveImports: (path: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
        fileService.resolveImports(path, requests, options),
      saveSession: vi.fn(),
    } as unknown as FileGateway;

    const { references: initialRefs } = await resolveAllImports(
      initialGateway,
      tecsgenGateway,
      editablePath,
      editableContent,
      emptyToolInfoTecsgen(),
      parsed.importPaths,
    );

    // 2回目のセッション（アプリ再起動時: settings.json の referencePaths + editablePath を openPaths で開く）
    const savedReferencePaths = initialRefs.map((r) => r.path);
    const allPaths = [...savedReferencePaths, editablePath];
    const restoredOpenResult = await fileService.openPaths(allPaths);

    const store = new AppStore();
    const restoreGateway = {
      resolveImports: (path: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
        fileService.resolveImports(path, requests, options),
      saveSession: vi.fn(),
    } as unknown as FileGateway;

    // セッション復元時は lastSession.extraImportPaths が restoredOpenResult.extraImportPaths として渡される
    await applyOpenResult(store, restoreGateway, tecsgenGateway, {
      ...restoredOpenResult,
      extraImportPaths: parsed.importPaths,
    });

    const report = store.getReport();
    expect(report.errorCount).toBe(0);
    expect(report.items.filter((d) => d.code === W_CODES.UNRESOLVED_REF_FILE)).toEqual([]);

    const doc = store.getDocument();
    expect(doc.cellCount).toBe(60);
    expect(doc.celltypeCount).toBe(84);
    expect(doc.joinCount).toBe(31);
  });
});

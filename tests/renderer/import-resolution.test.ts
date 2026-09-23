// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.4節・第7E章7.5.4〜7.5.5節 — `resolveAllImports`の
// renderer側オーケストレーション（推移的closure・循環/重複抑止・import_Cの除外）を検証する。
// `FileGateway.resolveImports`はフェイクに置き換える——探索アルゴリズム自体（searchDirs×
// importPaths）は`tests/main/file-service.test.ts`が検証済みのため、ここでは
// 「1件の解決結果をどう扱うか」だけをテスト範囲とする。

import { describe, expect, it, vi } from "vitest";
import { resolveAddedReference, resolveAllImports } from "../../src/renderer/app/import-resolution";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { CppResult } from "../../src/shared/ipc-types.js";
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

// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.4節・第7E章7.5.4〜7.5.5節 — `resolveAllImports`の
// renderer側オーケストレーション（推移的closure・循環/重複抑止・import_Cの除外）を検証する。
// `FileGateway.resolveImports`はフェイクに置き換える——探索アルゴリズム自体（searchDirs×
// importPaths）は`tests/main/file-service.test.ts`が検証済みのため、ここでは
// 「1件の解決結果をどう扱うか」だけをテスト範囲とする。

import { describe, expect, it, vi } from "vitest";
import { resolveAllImports } from "../../src/renderer/app/import-resolution";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
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

const toolInfo = emptyToolInfoTecsgen();

describe("resolveAllImports", () => {
  it("resolves a single import and adds it as a reference", async () => {
    const { gateway } = fakeGateway({ "B.cdl": { canonicalPath: "/root/B.cdl", content: "" } });

    const { references, diagnostics } = await resolveAllImports(
      gateway,
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

    const { references } = await resolveAllImports(gateway, "/root/A.cdl", 'import("B.cdl");', toolInfo);

    expect(references.map((r) => r.path)).toEqual(["/root/B.cdl", "/root/C.cdl"]);
  });

  it("does not loop forever on an import cycle, and never adds the editable file itself as a reference", async () => {
    const editablePath = "/root/A.cdl";
    const { gateway, calls } = fakeGateway({
      "A.cdl": { canonicalPath: editablePath, content: "unused" }, // B が import("A.cdl") で参照し返す
      "B.cdl": { canonicalPath: "/root/B.cdl", content: 'import("A.cdl");' },
    });

    const { references, diagnostics } = await resolveAllImports(gateway, editablePath, 'import("B.cdl");', toolInfo);

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

    const { references, diagnostics } = await resolveAllImports(
      gateway,
      "/root/A.cdl",
      'import_C("foo.h");',
      toolInfo,
    );

    expect(references).toEqual([]);
    expect(diagnostics).toEqual([]);
    expect(calls).toHaveLength(1); // foo.hの内容から抽出されたimportで2周目が発生していない
  });

  it("passes toolInfo.baseDir/importPath through to the gateway as ImportResolutionOptions", async () => {
    const { gateway } = fakeGateway({ "B.cdl": { canonicalPath: "/root/B.cdl", content: "" } });
    const resolveImportsSpy = gateway.resolveImports as unknown as ReturnType<typeof vi.fn>;

    await resolveAllImports(gateway, "/root/A.cdl", 'import("B.cdl");', {
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
});

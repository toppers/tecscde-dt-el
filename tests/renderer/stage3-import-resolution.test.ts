import { describe, expect, it, vi } from "vitest";
import { resolveAllImports, resolveAddedReference } from "../../src/renderer/app/import-resolution";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { ImportRequest, ImportResolutionOptions } from "../../src/shared/ipc-types";

const info = emptyToolInfoTecsgen();
const tool = { preprocess: vi.fn(async () => ({ executableFound: true, exitCode: 0, stdout: "typedef int INT;", stderr: "" })) } as unknown as TecsgenGateway;

describe("stage3 import identities and contexts", () => {
  it("does not resolve another directory's x.cdl from the loaded basename cache", async () => {
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[], _options: ImportResolutionOptions) =>
      requests.map((request) => ({ request, canonicalPath: "/B/x.cdl", content: "celltype tB {};" })));
    const gateway = { resolveImports } as unknown as FileGateway;
    const result = await resolveAllImports(gateway, tool, "/main.cdl", 'import("B/x.cdl");', info, [],
      [{ path: "/A/x.cdl", content: "celltype tA {};" }]);
    expect(new Set(result.references.map((entry) => entry.path))).toEqual(new Set(["/A/x.cdl", "/B/x.cdl"]));
    expect(resolveImports).toHaveBeenCalledWith("/main.cdl", [{ kind: "import", specifier: "B/x.cdl" }], expect.anything());
  });

  it("does not resurrect a list-rejected import merely because its basename is already loaded", async () => {
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[], _options: ImportResolutionOptions) =>
      requests.map((request) => ({ request, error: "not-found" as const })));
    const result = await resolveAllImports({ resolveImports } as unknown as FileGateway, tool, "/main.cdl", 'import("x.cdl");', info, [],
      [{ path: "/sys/x.cdl", content: "celltype tExisting {};" }], ["/sys"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.references).toEqual([{ path: "/sys/x.cdl", content: "celltype tExisting {};" }]);
    expect(resolveImports.mock.calls[0]?.[2]).toMatchObject({ systemDirs: ["/sys"] });
  });

  it("reuses the existing in-memory body only after main resolves the same normalized Windows source", async () => {
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[]) =>
      requests.map((request) => ({ request, canonicalPath: request.specifier === "nested.cdl" ? "C:\\A\\nested.cdl" : "c:/a/./X.cdl",
        content: request.specifier === "nested.cdl" ? "celltype tNested {};" : "old disk body" })));
    const body = 'import("nested.cdl"); celltype tEdited {};';
    const result = await resolveAllImports({ resolveImports } as unknown as FileGateway, tool, "C:\\main.cdl", 'import("x.cdl");', info, [],
      [{ path: "C:\\A\\X.cdl", content: body }]);
    expect(result.references.find((entry) => entry.path === "C:\\A\\X.cdl")?.content).toBe(body);
    expect(result.references).toHaveLength(2);
    expect(resolveImports.mock.calls.some(([, requests]) => requests.some((request) => request.specifier === "x.cdl"))).toBe(true);
  });

  it("deduplicates Windows path aliases when a manually requested file was already loaded", async () => {
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[], _options: ImportResolutionOptions) =>
      requests.map((request) => ({ request, canonicalPath: "c:/a/./x.cdl", content: "" })));
    const result = await resolveAddedReference({ resolveImports } as unknown as FileGateway, tool, "C:\\main.cdl", info,
      "c:/a/x.cdl", ["C:\\A\\X.cdl"], ["C:\\sys"]);
    expect(result.references).toEqual([]);
    expect(resolveImports.mock.calls[0]?.[2]).toMatchObject({ systemDirs: ["C:\\sys"] });
  });

  it("uses each recursive source's directory as its own resolution context", async () => {
    const resolveImports = vi.fn(async (from: string, requests: readonly ImportRequest[]) => requests.map((request) => {
      const path = request.specifier === "x.cdl" ? from.replace(/parent.cdl$/, "x.cdl") : "/" + request.specifier;
      return { request, canonicalPath: path, content: path.endsWith("parent.cdl") ? 'import("x.cdl");' : "" };
    }));
    const result = await resolveAllImports({ resolveImports } as unknown as FileGateway, tool, "/main.cdl",
      'import("A/parent.cdl"); import("B/parent.cdl");', info);
    expect(result.references.map((entry) => entry.path)).toEqual(["/A/parent.cdl", "/B/parent.cdl", "/A/x.cdl", "/B/x.cdl"]);
    expect(resolveImports.mock.calls.map(([from]) => from)).toEqual(["/main.cdl", "/A/parent.cdl", "/B/parent.cdl"]);
  });

  it("forwards systemDirs in every recursive resolution batch", async () => {
    const optionsSeen: ImportResolutionOptions[] = [];
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) => {
      optionsSeen.push(options);
      return requests.map((request) => ({ request, canonicalPath: "/sys/" + request.specifier,
        content: request.specifier === "first.cdl" ? 'import("second.cdl");' : "" }));
    });
    await resolveAllImports({ resolveImports } as unknown as FileGateway, tool, "/main.cdl", 'import("first.cdl");', info, [], [], ["/sys"]);
    expect(optionsSeen).toHaveLength(2);
    expect(optionsSeen.every((options) => options.systemDirs?.[0] === "/sys")).toBe(true);
  });

  it("keeps absolute include paths intact when building preprocessor include directories", async () => {
    const resolveImports = vi.fn(async (_from: string, requests: readonly ImportRequest[]) =>
      requests.map((request) => ({ request, canonicalPath: "/header.h", content: "typedef int INT;" })));
    const preprocess = vi.fn(async (_path: string, _cpp: string | undefined, _dirs: readonly string[]) =>
      ({ executableFound: true, exitCode: 0, stdout: "typedef int INT;", stderr: "" }));
    await resolveAllImports({ resolveImports } as unknown as FileGateway, { preprocess } as unknown as TecsgenGateway,
      "/root/sub/main.cdl", 'import_C("header.h");', { ...info, baseDir: "/base", importPath: ["/absolute/include", "C:\\SDK\\include", "."] });
    expect(preprocess.mock.calls[0]?.[2]).toEqual(["/absolute/include", "C:\\SDK\\include", "/root/sub", "/base"]);
  });
});

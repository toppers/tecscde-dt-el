import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FileService } from "../../src/main/file-service.js";
import type { ImportResolutionOptions, ImportRequest } from "../../src/shared/ipc-types.js";

vi.mock("electron", () => ({ dialog: {}, app: { getPath: vi.fn() } }));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tecscde-stage3-import-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
function file(path: string, content = path) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path;
}
const request = (specifier: string, kind: ImportRequest["kind"] = "import"): ImportRequest => ({ kind, specifier });
async function lookup(specifier: string, options: ImportResolutionOptions, kind: ImportRequest["kind"] = "import") {
  const result = await new FileService({} as never).resolveImports(join(dir, "src", "main.cdl"), [request(specifier, kind)], options);
  return result[0]!;
}

describe("stage3 directory-local CDL lists", () => {
  it("uses each candidate's own directory list, normalizing BOM, blanks and separators", async () => {
    const sys = join(dir, "sys");
    const target = file(join(sys, "sub", "x.cdl"), "sub-source");
    file(join(sys, "_CDL_FILES.txt"), "sub/x.cdl\n");
    file(join(sys, "sub", "_CDL_FILES.txt"), "\uFEFF \r\n .\\//x.cdl \r\n\r\n");
    expect(await lookup("sub/x.cdl", { importPaths: [sys], systemDirs: [sys] })).toMatchObject({ canonicalPath: target, content: "sub-source" });
    file(join(sys, "sub", "_CDL_FILES.txt"), "different.cdl\n");
    expect(await lookup("sub/x.cdl", { importPaths: [sys], systemDirs: [sys] })).toMatchObject({ error: "not-found" });
  });

  it("does not apply a parent's list when the child's list is missing", async () => {
    const sys = join(dir, "sys");
    const target = file(join(sys, "sub", "nested", "x.cdl"));
    file(join(sys, "_CDL_FILES.txt"), "only-root.cdl\n");
    file(join(sys, "sub", "_CDL_FILES.txt"), "only-child.cdl\n");
    expect(await lookup("sub/nested/x.cdl", { importPaths: [sys], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
  });

  it("skips an unlisted existing file and continues to the next ordinary search path", async () => {
    const sys = join(dir, "sys"); const other = join(dir, "other");
    file(join(sys, "x.cdl"), "unlisted");
    file(join(sys, "_CDL_FILES.txt"), "other.cdl\n");
    const target = file(join(other, "x.cdl"), "fallback");
    expect(await lookup("x.cdl", { importPaths: [sys, other], systemDirs: [sys] })).toMatchObject({ canonicalPath: target, content: "fallback" });
  });

  it("continues after a listed file is absent", async () => {
    const sys = join(dir, "sys"); const other = join(dir, "other");
    file(join(sys, "_CDL_FILES.txt"), "x.cdl\n");
    const target = file(join(other, "x.cdl"), "fallback");
    expect(await lookup("x.cdl", { importPaths: [sys, other], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
  });

  it("does not read later system lists after an earlier ordinary candidate succeeds", async () => {
    const target = file(join(dir, "src", "x.cdl"));
    const sys = join(dir, "sys");
    const list = file(join(sys, "_CDL_FILES.txt"), "x.cdl\n");
    const read = vi.spyOn(fs, "readFile");
    expect(await lookup("x.cdl", { importPaths: [".", sys], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
    expect(read.mock.calls.some(([path]) => String(path) === list)).toBe(false);
  });

  it("probes normally if its list cannot be read", async () => {
    const sys = join(dir, "sys"); const target = file(join(sys, "x.cdl"));
    const read = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(((path: Parameters<typeof fs.readFile>[0], ...args: unknown[]) => {
      if (String(path) === join(sys, "_CDL_FILES.txt")) return Promise.reject(Object.assign(Error("denied"), { code: "EACCES" }));
      return (read as (...args: unknown[]) => unknown)(path, ...args);
    }) as typeof fs.readFile);
    expect(await lookup("x.cdl", { importPaths: [sys], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
  });

  it.each(["import_C", "manual"] as const)("does not restrict %s by the CDL list", async (kind) => {
    const sys = join(dir, "sys"); const target = file(join(sys, "x.cdl"));
    file(join(sys, "_CDL_FILES.txt"), "other.cdl\n");
    expect(await lookup(kind === "manual" ? target : "x.cdl", { importPaths: [sys], systemDirs: [sys] }, kind)).toMatchObject({ canonicalPath: target });
  });

  it("does not use a list outside -S, including a path escaping via dot-dot", async () => {
    const sys = join(dir, "sys"); mkdirSync(sys);
    const target = file(join(dir, "outside", "x.cdl"));
    file(join(dir, "outside", "_CDL_FILES.txt"), "other.cdl\n");
    expect(await lookup("../outside/x.cdl", { importPaths: [sys], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
    expect(await lookup("x.cdl", { importPaths: [join(dir, "outside")] })).toMatchObject({ canonicalPath: target });
  });

  it("uses systemDirs as final listed-only candidates when relative -S cannot be resolved from the primary", async () => {
    const sys = join(dir, "opts", "sys"); const target = file(join(sys, "x.cdl"));
    expect(await lookup("x.cdl", { importPaths: ["./sys"], systemDirs: [sys] })).toMatchObject({ error: "not-found" });
    file(join(sys, "_CDL_FILES.txt"), "x.cdl\n");
    expect(await lookup("x.cdl", { importPaths: ["./sys"], systemDirs: [sys] })).toMatchObject({ canonicalPath: target });
  });

  it("caches each directory list within one batch and refreshes it on the next resolve", async () => {
    const sys = join(dir, "sys"); file(join(sys, "x.cdl")); file(join(sys, "y.cdl"));
    const list = file(join(sys, "_CDL_FILES.txt"), "x.cdl\ny.cdl\n");
    const read = vi.spyOn(fs, "readFile");
    const service = new FileService({} as never);
    const options = { importPaths: [sys, sys], systemDirs: [sys] };
    const batch = await service.resolveImports(join(dir, "main.cdl"), [request("x.cdl"), request("y.cdl")], options);
    expect(batch.every((entry) => entry.content !== undefined)).toBe(true);
    expect(read.mock.calls.filter(([path]) => String(path) === list)).toHaveLength(1);
    file(list, "other.cdl\n");
    expect(await service.resolveImports(join(dir, "main.cdl"), [request("x.cdl")], options)).toMatchObject([{ error: "not-found" }]);
    expect(read.mock.calls.filter(([path]) => String(path) === list)).toHaveLength(2);
  });

  it.skipIf(process.platform !== "win32")("matches listed names case-insensitively on Windows and keeps the listed path spelling", async () => {
    const sys = join(dir, "sys"); file(join(sys, "X.CDL"), "upper");
    file(join(sys, "_CDL_FILES.txt"), ".\\X.CDL\r\n");
    expect(await lookup("x.cdl", { importPaths: [sys], systemDirs: [sys.toUpperCase()] })).toMatchObject({ canonicalPath: join(sys, "X.CDL"), content: "upper" });
  });
});

describe("stage3 absolute import paths", () => {
  it("resolves each absolute or relative directory before connecting the requested file", async () => {
    const target = file(join(dir, "include", "x.cdl"));
    expect(await lookup("x.cdl", { importPaths: ["../include"] })).toMatchObject({ canonicalPath: target });
    expect(await lookup("x.cdl", { importPaths: [join(dir, "include")] })).toMatchObject({ canonicalPath: target });
  });
  it.skipIf(process.platform !== "win32")("keeps a different-drive or UNC include path independent of the primary directory", async () => {
    const read = vi.spyOn(fs, "readFile").mockRejectedValue(Object.assign(Error("not found"), { code: "ENOENT" }));
    await new FileService({} as never).resolveImports("C:\\project\\main.cdl", [request("x.cdl")], {
      importPaths: ["D:\\includes", "\\\\server\\share\\includes"], extraSearchDirs: ["C:\\other"],
    });
    expect(read.mock.calls.map(([path]) => String(path))).toEqual(["D:\\includes\\x.cdl", "\\\\server\\share\\includes\\x.cdl"]);
  });
});

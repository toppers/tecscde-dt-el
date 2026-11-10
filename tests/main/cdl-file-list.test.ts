import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CdlFileListService, compareCdlNames, compareCdlPaths } from "../../src/main/cdl-file-list.js";

describe("CDL file list generation", () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), "tecscde-lists 日本語-")); });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

  async function put(path: string, text = "") {
    await fs.mkdir(resolve(path, ".."), { recursive: true });
    await fs.writeFile(path, text);
  }

  it("sorts names by case-insensitive code points with an original-case tie break, and paths by components", () => {
    expect(["z.cdl", "B.cdl", "a.CDL", "A.cdl", "日本語.cdl"].sort(compareCdlNames))
      .toEqual(["A.cdl", "a.CDL", "B.cdl", "z.cdl", "日本語.cdl"]);
    expect(compareCdlNames("\uE000", "😀")).toBeLessThan(0);
    expect(["/root/a-branch/_CDL_FILES.txt", "/root/a/nested/_CDL_FILES.txt"].sort(compareCdlPaths))
      .toEqual(["/root/a/nested/_CDL_FILES.txt", "/root/a-branch/_CDL_FILES.txt"]);
    expect(compareCdlPaths("C:\\A\\b", "C:/a/B")).toBeLessThan(0);
  });

  it("plans without writing, descends empty intermediate directories and emits root-inclusive UTF-8 LF lists", async () => {
    await put(join(root, "b.CDL")); await put(join(root, "A.cdl"));
    await put(join(root, "empty middle", "深い", "子.cDl")); await put(join(root, "not-cdl.txt"));
    const service = new CdlFileListService();
    const planned = await service.plan(root);
    expect(planned.kind).toBe("planned");
    if (planned.kind !== "planned") return;
    expect(planned.items).toHaveLength(3);
    expect(planned.items.every((item) => item.status === "new")).toBe(true);
    await expect(fs.stat(join(root, "_ROOT_CDL_FILES.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const result = await service.apply(planned.planId);
    expect(result).toEqual({ kind: "ok", rootListPath: join(root, "_ROOT_CDL_FILES.txt"), listCount: 2, skippedSame: 0 });
    expect(await fs.readFile(join(root, "_CDL_FILES.txt"), "utf8")).toBe("A.cdl\nb.CDL\n");
    expect(await fs.readFile(join(root, "empty middle", "深い", "_CDL_FILES.txt"), "utf8")).toBe("子.cDl\n");
    const expected = [join(root, "_CDL_FILES.txt"), join(root, "empty middle", "深い", "_CDL_FILES.txt")].sort(compareCdlPaths).join("\n") + "\n";
    const bytes = await fs.readFile(join(root, "_ROOT_CDL_FILES.txt"));
    expect(bytes.toString("utf8")).toBe(expected);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))).toBe(false);
  });

  it("preserves previous lists and creates nothing when no CDL exists", async () => {
    await put(join(root, "_CDL_FILES.txt"), "old.cdl\n");
    await put(join(root, "_ROOT_CDL_FILES.txt"), "old root\n");
    const write = vi.spyOn(fs, "writeFile");
    expect(await new CdlFileListService().plan(root)).toEqual({ kind: "empty" });
    expect(write).not.toHaveBeenCalled();
    expect(await fs.readFile(join(root, "_CDL_FILES.txt"), "utf8")).toBe("old.cdl\n");
    expect(await fs.readFile(join(root, "_ROOT_CDL_FILES.txt"), "utf8")).toBe("old root\n");
  });

  it("marks differing existing lists for one caller confirmation and skips byte-identical lists", async () => {
    await put(join(root, "a.cdl"));
    await put(join(root, "_CDL_FILES.txt"), "old.cdl\n");
    const service = new CdlFileListService();
    const planned = await service.plan(root);
    if (planned.kind !== "planned") throw Error("expected plan");
    expect(planned.items.find((item) => item.path === join(root, "_CDL_FILES.txt"))?.status).toBe("differs");
    expect(await fs.readFile(join(root, "_CDL_FILES.txt"), "utf8")).toBe("old.cdl\n");
    await service.apply(planned.planId);
    const same = await service.plan(root);
    if (same.kind !== "planned") throw Error("expected plan");
    expect(same.items.every((item) => item.status === "same")).toBe(true);
    const write = vi.spyOn(fs, "writeFile");
    expect(await service.apply(same.planId)).toMatchObject({ kind: "ok", listCount: 1, skippedSame: 2 });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["changed", "created", "removed"])("preflights every existing list before writes when a list is %s after planning", async (change) => {
    await put(join(root, "a.cdl"));
    const child = join(root, "_CDL_FILES.txt");
    if (change !== "created") await put(child, "old\n");
    const service = new CdlFileListService();
    const planned = await service.plan(root);
    if (planned.kind !== "planned") throw Error("expected plan");
    if (change === "removed") await fs.unlink(child); else await put(child, "concurrent\n");
    const write = vi.spyOn(fs, "writeFile");
    expect(await service.apply(planned.planId)).toEqual({ kind: "changed", path: child });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects invalid roots and source enumeration failures without writing partial lists", async () => {
    const service = new CdlFileListService();
    expect(await service.plan("")).toMatchObject({ kind: "failed" });
    expect(await service.plan(join(root, "missing"))).toMatchObject({ kind: "failed" });
    await put(join(root, "a.cdl"));
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(Object.assign(Error("access denied"), { code: "EACCES" }));
    expect(await service.plan(root)).toMatchObject({ kind: "failed", path: root, detail: "access denied" });
    await expect(fs.stat(join(root, "_CDL_FILES.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes children first, reports a child failure and leaves the previous root list unchanged", async () => {
    await put(join(root, "a", "a.cdl")); await put(join(root, "b", "b.cdl"));
    const rootList = join(root, "_ROOT_CDL_FILES.txt"); await put(rootList, "previous root\n");
    const service = new CdlFileListService();
    const planned = await service.plan(root); if (planned.kind !== "planned") throw Error("expected plan");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === join(root, "b", "_CDL_FILES.txt")) throw Error("child denied");
      return rename(from, to);
    });
    expect(await service.apply(planned.planId)).toEqual({ kind: "failed", path: join(root, "b", "_CDL_FILES.txt"),
      detail: "child denied", writtenPaths: [join(root, "a", "_CDL_FILES.txt")] });
    expect(await fs.readFile(rootList, "utf8")).toBe("previous root\n");
    expect((await fs.readdir(join(root, "b"))).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("reports a root-list write failure after successful children without claiming rollback", async () => {
    await put(join(root, "a.cdl"));
    const rootList = join(root, "_ROOT_CDL_FILES.txt"); await put(rootList, "previous\n");
    const service = new CdlFileListService();
    const planned = await service.plan(root); if (planned.kind !== "planned") throw Error("expected plan");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => { if (String(to) === rootList) throw Error("root denied"); return rename(from, to); });
    expect(await service.apply(planned.planId)).toEqual({ kind: "failed", path: rootList, detail: "root denied", writtenPaths: [join(root, "_CDL_FILES.txt")] });
    expect(await fs.readFile(rootList, "utf8")).toBe("previous\n");
  });

  it("does not traverse directory junctions, including cycles", async () => {
    await put(join(root, "a.cdl"));
    await fs.symlink(root, join(root, "loop"), process.platform === "win32" ? "junction" : "dir");
    const result = await new CdlFileListService().plan(root);
    expect(result.kind).toBe("planned");
    if (result.kind === "planned") expect(result.items).toHaveLength(2);
  });

  it("includes a file symbolic link as its own literal CDL name", async () => {
    // lstat/stat emulate the file link so this contract also runs on Windows
    // accounts without SeCreateSymbolicLinkPrivilege.
    await put(join(root, "original.cdl")); await put(join(root, "alias.CDL"));
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation((async (path, ...options) => {
      const actual = await lstat(path, ...options);
      return String(path) === join(root, "alias.CDL") ? { ...actual, isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false } : actual;
    }) as typeof fs.lstat);
    const service = new CdlFileListService();
    const planned = await service.plan(root); if (planned.kind !== "planned") throw Error("expected plan");
    await service.apply(planned.planId);
    expect(await fs.readFile(join(root, "_CDL_FILES.txt"), "utf8")).toBe("alias.CDL\noriginal.cdl\n");
  });

  it("rejects unknown, consumed and expired plan IDs", async () => {
    await put(join(root, "a.cdl"));
    let time = 1;
    const service = new CdlFileListService({ now: () => time, planLifetimeMs: 100 });
    expect(await service.apply("not-a-plan")).toMatchObject({ kind: "failed", writtenPaths: [] });
    const planned = await service.plan(root); if (planned.kind !== "planned") throw Error("expected plan");
    await service.apply(planned.planId);
    expect(await service.apply(planned.planId)).toMatchObject({ kind: "failed", writtenPaths: [] });
    const expired = await service.plan(root); if (expired.kind !== "planned") throw Error("expected plan");
    time += 101;
    expect(await service.apply(expired.planId)).toMatchObject({ kind: "failed", writtenPaths: [] });
  });

  it("rejects a duplicate start while scanning and permits the next generation", async () => {
    await put(join(root, "a.cdl"));
    let release!: () => void;
    const pause = new Promise<void>((done) => { release = done; });
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementationOnce((async (...args: Parameters<typeof fs.readdir>) => {
      await pause;
      return readdir(...args);
    }) as typeof fs.readdir);
    const service = new CdlFileListService();
    const first = service.plan(root);
    const duplicate = await service.plan(root);
    expect(duplicate).toMatchObject({ kind: "failed", detail: "一覧生成は既に処理中です。" });
    release();
    const plan = await first; if (plan.kind !== "planned") throw Error("expected plan");
    expect(await service.apply(plan.planId)).toMatchObject({ kind: "ok" });
    expect(await service.plan(root)).toMatchObject({ kind: "planned" });
  });
});

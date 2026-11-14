// [[TECSCDE-DT-EL内部仕様]] 第7B章「ファイルブラウザ設計」7.6.6節 — アプリケーション設定の
// 永続化の単体テスト。`app.getPath`はモックし、実際の一時ディレクトリに対して読み書きする。
// Windowsでは`LOCALAPPDATA`（`vi.stubEnv`で一時ディレクトリへ差し替え）を優先し、
// `app.getPath('userData')`（Roaming）へは書かない（2026-09-22、ローミング同期回避のため）。

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const getPath = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: (...args: unknown[]) => getPath(...args) },
}));

const { loadAppSettings, saveAppSettings, logsDirectory } = await import("../../src/main/app-settings.js");

describe("app-settings", () => {
  let userDataDir: string;
  let localAppDataDir: string;
  let originalPlatform: PropertyDescriptor;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-userdata-"));
    localAppDataDir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-localappdata-"));
    getPath.mockReturnValue(userDataDir);
    // LOCALAPPDATA分岐はWindows限定のため、実行OSに関わらずwin32として扱い、
    // LOCALAPPDATAを一時ディレクトリへ差し替えて分離する。
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.stubEnv("LOCALAPPDATA", localAppDataDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", originalPlatform);
    vi.unstubAllEnvs();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(localAppDataDir, { recursive: true, force: true });
  });

  it("logsDirectory is logs/ in the same folder as settings.json: LOCALAPPDATA/tecscde-dt-el/logs (spec 9.5.2 rule 2)", () => {
    expect(logsDirectory()).toBe(join(localAppDataDir, "tecscde-dt-el", "logs"));
    expect(getPath).not.toHaveBeenCalled(); // Roaming の userData には置かない
  });

  it("loadAppSettings returns {} when no settings file exists yet (初回起動)", async () => {
    await expect(loadAppSettings()).resolves.toEqual({});
  });

  it("saveAppSettings writes under LOCALAPPDATA/tecscde-dt-el, not app.getPath('userData') (2026-09-22)", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    const saved = JSON.parse(readFileSync(join(localAppDataDir, "tecscde-dt-el", "settings.json"), "utf-8")) as {
      fileBrowserRoot?: string;
    };
    expect(saved.fileBrowserRoot).toBe("/root/project");
    expect(getPath).not.toHaveBeenCalled();
  });

  it("loadAppSettings returns {} when the settings file is corrupted, without throwing", async () => {
    writeFileSync(join(localAppDataDir, "settings.json"), "{not json"); // 誤った場所（サブディレクトリ無し）に置いても影響しないことの確認を兼ねる
    await expect(loadAppSettings()).resolves.toEqual({});
  });

  it("saveAppSettings then loadAppSettings round-trips the fileBrowserRoot", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root/project" });
  });

  it("saveAppSettings overwrites the previous value", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/a" });
    await saveAppSettings({ fileBrowserRoot: "/root/b" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root/b" });
  });

  it("saveAppSettings then loadAppSettings round-trips lastSession", async () => {
    await saveAppSettings({
      lastSession: { editablePath: "/root/main.cde", referencePaths: ["/root/celltypes.cdl"] },
    });
    await expect(loadAppSettings()).resolves.toEqual({
      lastSession: { editablePath: "/root/main.cde", referencePaths: ["/root/celltypes.cdl"], extraImportPaths: [], sourceOrder: ["/root/celltypes.cdl", "/root/main.cde"] },
    });
  });

  it("saveAppSettings then loadAppSettings round-trips lastSession with extraImportPaths", async () => {
    await saveAppSettings({
      lastSession: {
        editablePath: "/root/main.cde",
        referencePaths: ["/root/celltypes.cdl"],
        extraImportPaths: ["/root/include", "/root/lib"],
      },
    });
    await expect(loadAppSettings()).resolves.toEqual({
      lastSession: {
        editablePath: "/root/main.cde",
        referencePaths: ["/root/celltypes.cdl"],
        extraImportPaths: ["/root/include", "/root/lib"],
        sourceOrder: ["/root/celltypes.cdl", "/root/main.cde"],
      },
    });
  });

  it("saveAppSettings merges lastSession without clobbering a previously saved fileBrowserRoot (2026-09-22)", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });
    await saveAppSettings({ lastSession: { editablePath: "/root/main.cde", referencePaths: [] } });

    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root/project",
      lastSession: { editablePath: "/root/main.cde", referencePaths: [], extraImportPaths: [], sourceOrder: ["/root/main.cde"] },
    });
  });

  it("saveAppSettings merges fileBrowserRoot without clobbering a previously saved lastSession (2026-09-22)", async () => {
    await saveAppSettings({ lastSession: { editablePath: "/root/main.cde", referencePaths: [] } });
    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root/project",
      lastSession: { editablePath: "/root/main.cde", referencePaths: [], extraImportPaths: [], sourceOrder: ["/root/main.cde"] },
    });
  });

  it("falls back to app.getPath('userData') when LOCALAPPDATA is unset", async () => {
    vi.stubEnv("LOCALAPPDATA", "");

    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    expect(getPath).toHaveBeenCalledWith("userData");
    const saved = JSON.parse(readFileSync(join(userDataDir, "settings.json"), "utf-8")) as { fileBrowserRoot?: string };
    expect(saved.fileBrowserRoot).toBe("/root/project");
  });

  function seed(value: unknown): string {
    const dir = join(localAppDataDir, "tecscde-dt-el");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  it.each([{ value: null }, { value: [] }, { value: 42 }, { value: "text" }, { value: true }])("rejects non-object settings JSON $value", async ({ value }) => {
    seed(value);
    await expect(loadAppSettings()).resolves.toEqual({});
  });

  it("normalizes old empty sessions without writing back and retains unknown settings", async () => {
    const path = seed({ fileBrowserRoot: "/root", allowEditSystemDefined: "true", lastSession: {}, future: { value: 4 } });
    const original = readFileSync(path, "utf-8");
    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root", lastSession: { editablePath: null, referencePaths: [], extraImportPaths: [], sourceOrder: [] }, future: { value: 4 },
    });
    expect(readFileSync(path, "utf-8")).toBe(original);
  });

  it.each([
    { editablePath: 4 }, { referencePaths: ["/a", 3] }, { extraImportPaths: [false] }, { optionsFilePath: null },
    { editablePath: "/a", sourceOrder: [] }, { editablePath: "/a", sourceOrder: ["/a", "/a"] },
    { editablePath: "/a", sourceOrder: ["/a", "/b"] }, { editablePath: "/a", sourceOrder: "bad" },
  ])("invalidates only malformed session %j", async (lastSession) => {
    seed({ fileBrowserRoot: "/root", lastSession, unknown: 8 });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root", unknown: 8 });
  });

  it("deduplicates the source set but preserves explicit valid order and import path duplicates", async () => {
    seed({ lastSession: { editablePath: "/a", referencePaths: ["/b", "/a", "/b"], sourceOrder: ["/a", "/b"], extraImportPaths: ["inc", "inc"] } });
    expect((await loadAppSettings()).lastSession).toEqual({ editablePath: "/a", referencePaths: ["/b"], sourceOrder: ["/a", "/b"], extraImportPaths: ["inc", "inc"] });
  });

  it.each([
    { editablePath: "" }, { editablePath: "main.cde" }, { editablePath: "C:main.cde" },
    { referencePaths: [""] }, { referencePaths: ["ref.cdl"] },
    { optionsFilePath: "" }, { optionsFilePath: "settings.tecsgen-opts" },
    { editablePath: "/a", referencePaths: ["/b", "/c"], sourceOrder: ["/c", "/a", "/b"] },
  ])("invalidates non-absolute source paths or inconsistent reference order %j", async (lastSession) => {
    seed({ fileBrowserRoot: "/folder", lastSession });
    expect(await loadAppSettings()).toEqual({ fileBrowserRoot: "/folder" });
  });

  it("preserves UNC paths for I/O while comparing Windows path aliases case-insensitively", async () => {
    seed({ lastSession: {
      editablePath: "\\\\server\\share\\folder\\..\\main.cde",
      referencePaths: ["\\\\SERVER\\SHARE\\MAIN.CDE", "\\\\server\\share\\ref.cdl"],
      sourceOrder: ["\\\\SERVER\\share\\main.cde", "\\\\server\\share\\ref.cdl"],
      optionsFilePath: "\\\\server\\share\\options.tecsgen-opts",
    } });
    expect((await loadAppSettings()).lastSession).toEqual({
      editablePath: "\\\\server\\share\\main.cde",
      referencePaths: ["\\\\server\\share\\ref.cdl"],
      sourceOrder: ["\\\\SERVER\\share\\main.cde", "\\\\server\\share\\ref.cdl"],
      optionsFilePath: "\\\\server\\share\\options.tecsgen-opts",
      extraImportPaths: [],
    });
  });

  it("serializes the entire read-merge-write so concurrent folder/session updates retain both and unknown settings", async () => {
    seed({ future: { flag: true } });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const readFile = fs.readFile.bind(fs);
    let reads = 0;
    vi.spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      reads += 1;
      if (reads === 1) await blocked;
      return readFile(...args);
    }) as typeof fs.readFile);
    const folder = saveAppSettings({ fileBrowserRoot: "/folder" });
    const session = saveAppSettings({ lastSession: { editablePath: null, referencePaths: [] } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const readsBeforeRelease = reads;
    release();
    await Promise.all([folder, session]);
    expect(readsBeforeRelease).toBe(1);
    expect(await loadAppSettings()).toEqual({ fileBrowserRoot: "/folder", future: { flag: true }, lastSession: { editablePath: null, referencePaths: [], extraImportPaths: [], sourceOrder: [] } });
  });

  it("returns a failed write to its caller and continues the settings queue", async () => {
    const failure = new Error("write denied");
    vi.spyOn(fs, "writeFile").mockRejectedValueOnce(failure);
    const first = saveAppSettings({ fileBrowserRoot: "/old" });
    const second = saveAppSettings({ fileBrowserRoot: "/new" });
    await expect(first).rejects.toBe(failure);
    await second;
    expect((await loadAppSettings()).fileBrowserRoot).toBe("/new");
  });

  it("keeps same-key updates in request order and queues readers behind pending writes", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementationOnce((async (...args: Parameters<typeof fs.writeFile>) => {
      await blocked;
      return writeFile(...args);
    }) as typeof fs.writeFile);
    const first = saveAppSettings({ fileBrowserRoot: "/old" });
    const second = saveAppSettings({ fileBrowserRoot: "/new" });
    let observed = false;
    const read = loadAppSettings().then((value) => { observed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const observedBeforeRelease = observed;
    release();
    await Promise.all([first, second]);
    expect(observedBeforeRelease).toBe(false);
    expect((await read).fileBrowserRoot).toBe("/new");
  });

  it("saveAppSettings then loadAppSettings round-trips cppPath and cppArgs", async () => {
    await saveAppSettings({ cppPath: "/usr/bin/gcc", cppArgs: "-E -DTECSGEN" });
    await expect(loadAppSettings()).resolves.toEqual({
      cppPath: "/usr/bin/gcc",
      cppArgs: "-E -DTECSGEN",
    });
  });

  it("normalizeAppSettings strips non-string cppPath and cppArgs", async () => {
    seed({ cppPath: 123, cppArgs: true, fileBrowserRoot: "/root" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root" });
  });

  it("saveAppSettings then loadAppSettings round-trips pluginTypeSource", async () => {
    await saveAppSettings({ pluginTypeSource: "internal" });
    await expect(loadAppSettings()).resolves.toEqual({ pluginTypeSource: "internal" });

    await saveAppSettings({ pluginTypeSource: "external" });
    await expect(loadAppSettings()).resolves.toEqual({ pluginTypeSource: "external" });
  });

  it("normalizeAppSettings preserves valid pluginTypeSource and strips invalid values", async () => {
    seed({ pluginTypeSource: "internal", fileBrowserRoot: "/root" });
    await expect(loadAppSettings()).resolves.toEqual({ pluginTypeSource: "internal", fileBrowserRoot: "/root" });

    seed({ pluginTypeSource: "invalid", fileBrowserRoot: "/root", other: 123 });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root", other: 123 });

    seed({ pluginTypeSource: 42, fileBrowserRoot: "/root" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root" });

    seed({ pluginTypeSource: true, fileBrowserRoot: "/root" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root" });
  });

  it("saveAppSettings merges pluginTypeSource without clobbering other settings", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root", cppPath: "/bin/gcc" });
    await saveAppSettings({ pluginTypeSource: "internal" });
    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root",
      cppPath: "/bin/gcc",
      pluginTypeSource: "internal",
    });
  });
});

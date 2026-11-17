import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import {
  ToolSettingsService,
  findGccOnPath,
  resolveCppCommand,
  chooseCppPath,
} from "../../src/main/tool-settings.js";
import { splitCommand } from "../../src/main/tecsgen-path-resolver.js";

const showOpenDialogMock = vi.fn();
vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialogMock(...args) },
}));

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: unknown, result?: unknown) => void;
    execFileMock(...args.slice(0, -1)).then((result: unknown) => callback(null, result), (error: unknown) => callback(error));
  },
}));

function setup(initial: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}) {
  let saved = { ...initial };
  const save = vi.fn(async (patch: Record<string, unknown>) => { saved = { ...saved, ...patch }; });
  const existing = new Set<string>();
  const directories = new Set<string>();
  // 実装の pathExists と同じく、実行ファイル判定（第2引数）ではディレクトリを除く。
  const exists = vi.fn(async (path: string, executableFile = false) => existing.has(path) && !(executableFile && directories.has(path)));
  const service = new ToolSettingsService({
    env, platform: "linux", load: async () => saved, save, exists, pathCandidates: ["tecsgen"],
  });
  return { service, save, exists, existing, directories, saved: () => saved };
}

describe("ToolSettingsService", () => {
  it("honors the explicit environment command and preserves the saved path", async () => {
    const { service, save, exists } = setup({ tecsgenPath: "/saved/tecsgen", unknown: 3 }, {
      TECSGEN_COMMAND: 'ruby "/Program Files/tecsgen.rb"', TECSPATH: "/env/tool", PATH: "/bin",
    });
    expect(await service.get()).toMatchObject({ tecsgenPath: "/saved/tecsgen", tecspath: "/env/tool",
      effectiveSource: "environment", executable: "ruby", prefixArgs: ["/Program Files/tecsgen.rb"], override: true });
    expect(save).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled();
  });

  it.each(["", "   ", '""', '"unclosed'])("does not fall back for an invalid explicit command %j", async (command) => {
    const { service, save, exists } = setup({ tecsgenPath: "/saved/tecsgen" }, { TECSGEN_COMMAND: command, PATH: "/bin" });
    expect(await service.get()).toMatchObject({ effectiveSource: "invalid", executable: "", override: true });
    expect(save).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled();
  });

  it("uses a saved literal path even when it no longer exists", async () => {
    const { service, exists } = setup({ tecsgenPath: "/missing/tool with spaces" }, { TECSPATH: "/other/tool", PATH: "/bin" });
    expect(await service.resolveCommand()).toEqual({ executable: "/missing/tool with spaces", args: [], source: "settings", revision: 0 });
    expect(exists).not.toHaveBeenCalled();
  });

  it("auto-saves an existing TECSPATH executable file without deriving a command", async () => {
    const { service, save, existing } = setup({}, { TECSPATH: "/tecs/tecsgen", PATH: "/bin" });
    existing.add("/tecs/tecsgen");
    expect(await service.get()).toMatchObject({ tecsgenPath: "/tecs/tecsgen", effectiveSource: "tecspath", executable: "/tecs/tecsgen" });
    expect(save).toHaveBeenCalledExactlyOnceWith({ tecsgenPath: "/tecs/tecsgen" });
  });

  // 三者相違一覧 1-5（2026-11-17 決定）: TECSPATH がディレクトリのときは採用・保存せず、PATH 探索へ進む。
  it("ignores a TECSPATH that is a directory and falls through to the PATH search", async () => {
    const { service, save, existing, directories } = setup({}, { TECSPATH: "/tecs-directory", PATH: "/bin" });
    existing.add("/tecs-directory"); directories.add("/tecs-directory"); existing.add("/bin/tecsgen");
    expect(await service.get()).toMatchObject({ tecsgenPath: "/bin/tecsgen", effectiveSource: "path", executable: "/bin/tecsgen" });
    expect(save).toHaveBeenCalledExactlyOnceWith({ tecsgenPath: "/bin/tecsgen" });
  });

  it("keeps the command unset when TECSPATH is a directory and PATH has no tecsgen", async () => {
    const { service, save, existing, directories } = setup({}, { TECSPATH: "/tecs-directory", PATH: "/bin" });
    existing.add("/tecs-directory"); directories.add("/tecs-directory");
    expect(await service.get()).toMatchObject({ tecsgenPath: "", effectiveSource: "missing", executable: "" });
    expect(save).not.toHaveBeenCalled();
  });

  it("searches PATH from the first directory and persists the found path", async () => {
    const { service, existing, exists } = setup({}, { PATH: "/first:/second:/third" });
    existing.add("/second/tecsgen"); existing.add("/third/tecsgen");
    expect(await service.get()).toMatchObject({ tecsgenPath: "/second/tecsgen", executable: "/second/tecsgen", effectiveSource: "path" });
    expect(exists.mock.calls.map(([path]) => path)).toEqual(["/first/tecsgen", "/second/tecsgen"]);
  });

  it("keeps an undetected command unset", async () => {
    const { service, save } = setup({}, {});
    expect(await service.get()).toMatchObject({ tecsgenPath: "", effectiveSource: "missing", executable: "", override: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("snapshots startup environment and updates the effective command only after successful persistence", async () => {
    const env = { PATH: "/old" };
    const { service, save } = setup({ tecsgenPath: "/old/tool" }, env);
    const initial = await service.get();
    env.PATH = "/changed";
    save.mockRejectedValueOnce(Error("disk full"));
    expect(await service.update({ tecsgenPath: "/new/tool" })).toEqual({ ok: false, error: "disk full" });
    expect(await service.get()).toEqual(initial);
    const update = await service.update({ tecsgenPath: "/new/tool" });
    expect(update).toMatchObject({ ok: true, settings: { tecsgenPath: "/new/tool", revision: initial.revision + 1 } });
    expect(await service.resolveCommand()).toEqual({ executable: "/new/tool", args: [], source: "settings", revision: 1 });
  });

  it("empty save clears, then rediscovers using the frozen environment", async () => {
    const env = { PATH: "/startup" };
    const { service, existing, save } = setup({ tecsgenPath: "/saved/tool" }, env);
    await service.get(); existing.add("/startup/tecsgen"); env.PATH = "/changed";
    expect(await service.update({ tecsgenPath: "" })).toMatchObject({ ok: true,
      settings: { tecsgenPath: "/startup/tecsgen", effectiveSource: "path" } });
    expect(save.mock.calls.map(([patch]) => patch)).toEqual([{ tecsgenPath: "/startup/tecsgen" }]);
  });

  it("serializes competing updates and continues after a failure", async () => {
    const { service, save } = setup({ tecsgenPath: "/old/tool" });
    await service.get();
    let complete!: () => void;
    save.mockImplementationOnce(() => new Promise<void>((r) => { complete = r; }));
    const first = service.update({ tecsgenPath: "/first" });
    const second = service.update({ tecsgenPath: "/second" });
    await new Promise((r) => setTimeout(r, 0));
    expect(save).toHaveBeenCalledTimes(1);
    complete(); await Promise.all([first, second]);
    expect(await service.get()).toMatchObject({ tecsgenPath: "/second", revision: 2 });
  });

  // 三者相違一覧 1-6（2026-11-17 決定）: CDL一覧の対象ディレクトリを getToolSettings・updateToolSettings に統合する。
  it("returns the CDL list root from the stored settings, empty when unset", async () => {
    expect(await setup({ cdlFilesRoot: "/projects/cdl" }).service.get()).toMatchObject({ cdlFilesRoot: "/projects/cdl" });
    expect(await setup({}).service.get()).toMatchObject({ cdlFilesRoot: "" });
  });

  it("updates only the CDL list root, saves it, and returns the new revision and settings", async () => {
    const { service, save } = setup({ tecsgenPath: "/old/tool", cdlFilesRoot: "/before" });
    const initial = await service.get();
    expect(await service.update({ cdlFilesRoot: "/after" })).toMatchObject({
      ok: true, settings: { cdlFilesRoot: "/after", tecsgenPath: "/old/tool", revision: initial.revision + 1 },
    });
    expect(save).toHaveBeenCalledExactlyOnceWith({ cdlFilesRoot: "/after" });
    expect(await service.get()).toMatchObject({ cdlFilesRoot: "/after" });
  });

  it("reports a failed save of the CDL list root without changing the effective settings", async () => {
    const { service, save } = setup({ cdlFilesRoot: "/before" });
    const initial = await service.get();
    save.mockRejectedValueOnce(Error("disk full"));
    expect(await service.update({ cdlFilesRoot: "/after" })).toEqual({ ok: false, error: "disk full" });
    expect(await service.get()).toEqual(initial);
  });

  it("keeps the CDL list root when other settings are updated", async () => {
    const { service } = setup({ cdlFilesRoot: "/keep" });
    expect(await service.update({ cppArgs: "-E" })).toMatchObject({ ok: true, settings: { cdlFilesRoot: "/keep" } });
  });

  it("rejects a non-string CDL list root", async () => {
    const { service, save } = setup({});
    expect(await service.update({ cdlFilesRoot: 3 } as never)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects unsupported patch keys and non-string paths", async () => {
    const { service, save } = setup({ tecsgenPath: "/old/tool" });
    expect(await service.update({ tecsgenPath: 3 } as never)).toMatchObject({ ok: false });
    expect(await service.update({ tecsgenPath: "/new/tool", PATH: "/evil" } as never)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("checks an unsaved candidate as one literal executable without changing saved settings", async () => {
    const { service, save } = setup({ tecsgenPath: "/saved/tool" }, { TECSGEN_COMMAND: "overriding-tool --flag" });
    const before = await service.get();
    execFileMock.mockReset().mockResolvedValue({ stdout: "", stderr: " tecsgen 1.9.1 " });
    expect(await service.checkPath('/candidate with spaces/"literal"')).toMatchObject({ kind: "ok", text: "tecsgen 1.9.1" });
    expect(execFileMock).toHaveBeenCalledExactlyOnceWith('/candidate with spaces/"literal"', ["--version"], { timeout: 30_000, shell: false });
    expect(await service.get()).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it("normalizes known Windows environment names without changing their frozen values", async () => {
    const env = { tecsgen_command: 'ruby "C:\\Tools\\tecsgen.rb"', TecSpAtH: "C:\\tecs", Path: "C:\\bin" };
    const service = new ToolSettingsService({ env, platform: "win32", load: async () => ({ tecsgenPath: "saved" }), save: vi.fn() });
    env.tecsgen_command = "changed";
    expect(await service.get()).toMatchObject({ tecspath: "C:\\tecs", effectiveSource: "environment", executable: "ruby",
      prefixArgs: ["C:\\Tools\\tecsgen.rb"], override: true });
  });

  it("includes the active settings revision in the resolved execution snapshot", async () => {
    const { service } = setup({ tecsgenPath: "/old/tool" });
    const first = await service.resolveCommand();
    await service.update({ tecsgenPath: "/new/tool" });
    const second = await service.resolveCommand();
    expect(first.revision).toBe(0);
    expect(second.revision).toBe(1);
  });

  // --- V0.2.1: C プリプロセッサ設定の更新と解決 ---
  it("updates and clears cppPath and cppArgs via ToolSettingsService.update", async () => {
    const { service, save } = setup({});
    const updateResult = await service.update({ cppPath: "/usr/local/bin/gcc", cppArgs: "-E -DTECSGEN" });
    expect(updateResult).toMatchObject({
      ok: true,
      settings: {
        cppPath: "/usr/local/bin/gcc",
        cppArgs: "-E -DTECSGEN",
        effectiveCppCommand: "/usr/local/bin/gcc -E -DTECSGEN",
        cppOrigin: "settings",
        cppOriginReason: "ユーザ直接指定",
      },
    });
    expect(save).toHaveBeenCalledWith({ cppPath: "/usr/local/bin/gcc", cppArgs: "-E -DTECSGEN" });

    // clear cppPath
    const clearResult = await service.update({ cppPath: "" });
    expect(clearResult).toMatchObject({
      ok: true,
      settings: {
        cppPath: "",
      },
    });
  });

  it("rejects non-string cppPath or cppArgs in ToolSettingsService.update", async () => {
    const { service, save } = setup({});
    expect(await service.update({ cppPath: 123 } as never)).toMatchObject({ ok: false });
    expect(await service.update({ cppArgs: true } as never)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("defaults pluginTypeSource to 'external' and reads stored value", async () => {
    const { service: defaultService } = setup({});
    expect((await defaultService.get()).pluginTypeSource).toBe("external");

    const { service: internalService } = setup({ pluginTypeSource: "internal" });
    expect((await internalService.get()).pluginTypeSource).toBe("internal");
  });

  it("updates pluginTypeSource and increments revision via ToolSettingsService.update", async () => {
    const { service, save } = setup({});
    const initial = await service.get();
    expect(initial.pluginTypeSource).toBe("external");

    const updateResult = await service.update({ pluginTypeSource: "internal" });
    expect(updateResult).toMatchObject({
      ok: true,
      settings: {
        pluginTypeSource: "internal",
        revision: initial.revision + 1,
      },
    });
    expect(save).toHaveBeenCalledWith({ pluginTypeSource: "internal" });
    expect((await service.get()).pluginTypeSource).toBe("internal");

    const revertResult = await service.update({ pluginTypeSource: "external" });
    expect(revertResult).toMatchObject({
      ok: true,
      settings: {
        pluginTypeSource: "external",
        revision: initial.revision + 2,
      },
    });
    expect(save).toHaveBeenCalledWith({ pluginTypeSource: "external" });
    expect((await service.get()).pluginTypeSource).toBe("external");
  });

  it("rejects invalid pluginTypeSource in ToolSettingsService.update", async () => {
    const { service, save } = setup({});
    expect(await service.update({ pluginTypeSource: "invalid" as never })).toMatchObject({ ok: false });
    expect(await service.update({ pluginTypeSource: 123 as never })).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("findGccOnPath", () => {
  let tmpDir: string;
  let bin1: string;
  let bin2: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "find-gcc-test-"));
    bin1 = join(tmpDir, "bin1");
    bin2 = join(tmpDir, "bin2");
    mkdirSync(bin1, { recursive: true });
    mkdirSync(bin2, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prioritizes standalone gcc over prefix gcc in PATH order", () => {
    const ext = process.platform === "win32" ? ".exe" : "";
    writeFileSync(join(bin1, `arm-none-eabi-gcc${ext}`), "");
    if (process.platform !== "win32") chmodSync(join(bin1, `arm-none-eabi-gcc${ext}`), 0o755);
    writeFileSync(join(bin2, `gcc${ext}`), "");
    if (process.platform !== "win32") chmodSync(join(bin2, `gcc${ext}`), 0o755);

    const envPath = `${bin1}${delimiter}${bin2}`;
    const result = findGccOnPath(envPath);
    expect(result).toEqual({ name: "gcc", fullPath: join(bin2, `gcc${ext}`) });
  });

  it("finds prefix gcc ending in gcc such as arm-none-eabi-gcc.exe when standalone gcc is absent", () => {
    const ext = process.platform === "win32" ? ".exe" : "";
    writeFileSync(join(bin1, `arm-none-eabi-gcc${ext}`), "");
    if (process.platform !== "win32") chmodSync(join(bin1, `arm-none-eabi-gcc${ext}`), 0o755);

    const result = findGccOnPath(bin1);
    expect(result).toEqual({ name: `arm-none-eabi-gcc${ext}`, fullPath: join(bin1, `arm-none-eabi-gcc${ext}`) });
  });

  it("ignores non-gcc tools like gcc-ar and g++", () => {
    const ext = process.platform === "win32" ? ".exe" : "";
    writeFileSync(join(bin1, `gcc-ar${ext}`), "");
    writeFileSync(join(bin1, `g++${ext}`), "");
    if (process.platform !== "win32") {
      chmodSync(join(bin1, `gcc-ar${ext}`), 0o755);
      chmodSync(join(bin1, `g++${ext}`), 0o755);
    }

    const result = findGccOnPath(bin1);
    expect(result).toBeNull();
  });

  it("is case-insensitive for gcc executable matching (e.g. GCC.EXE)", () => {
    const ext = process.platform === "win32" ? ".EXE" : "";
    writeFileSync(join(bin1, `ARM-NONE-EABI-GCC${ext}`), "");
    if (process.platform !== "win32") chmodSync(join(bin1, `ARM-NONE-EABI-GCC${ext}`), 0o755);

    const result = findGccOnPath(bin1);
    expect(result).not.toBeNull();
    expect(result?.fullPath).toBe(join(bin1, `ARM-NONE-EABI-GCC${ext}`));
  });
});

describe("resolveCppCommand", () => {
  let tmpDir: string;
  let binDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "resolve-cpp-test-"));
    binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses cdlCppCommand as highest priority (origin: cdl, ユーザ直接指定)", () => {
    const res = resolveCppCommand("arm-none-eabi-gcc -E -DTECSGEN", { cppPath: "custom-gcc", cppArgs: "-O2" });
    expect(res).toMatchObject({
      command: "arm-none-eabi-gcc -E -DTECSGEN",
      executable: "arm-none-eabi-gcc",
      origin: "cdl",
      originReason: "ユーザ直接指定",
    });
  });

  it("extracts executable correctly from cdlCppCommand when quoted", () => {
    const res = resolveCppCommand('"C:\\Program Files\\GNU\\bin\\gcc.exe" -E -DTECSGEN', {});
    expect(res).toMatchObject({
      command: '"C:\\Program Files\\GNU\\bin\\gcc.exe" -E -DTECSGEN',
      executable: "C:\\Program Files\\GNU\\bin\\gcc.exe",
      origin: "cdl",
      originReason: "ユーザ直接指定",
    });
  });

  it("uses savedSettings.cppPath when cdl is empty (origin: settings, ユーザ直接指定)", () => {
    const res = resolveCppCommand(undefined, { cppPath: "my-gcc", cppArgs: "-E -DTEST" });
    expect(res).toMatchObject({
      command: "my-gcc -E -DTEST",
      executable: "my-gcc",
      origin: "settings",
      originReason: "ユーザ直接指定",
    });
  });

  it("quotes executable containing spaces in command and round-trips through splitCommand", () => {
    const cppPath = "C:\\Program Files\\GNU\\bin\\gcc.exe";
    const res = resolveCppCommand(undefined, { cppPath, cppArgs: "-E -DTECSGEN" });
    expect(res).toMatchObject({
      command: '"C:\\Program Files\\GNU\\bin\\gcc.exe" -E -DTECSGEN',
      executable: cppPath,
      origin: "settings",
      originReason: "ユーザ直接指定",
    });
    const parts = splitCommand(res.command);
    expect(parts).toEqual(["C:\\Program Files\\GNU\\bin\\gcc.exe", "-E", "-DTECSGEN"]);
  });

  it("uses savedSettings.cppPath without args when cppArgs is empty", () => {
    const res = resolveCppCommand(undefined, { cppPath: "my-gcc", cppArgs: "" });
    expect(res).toMatchObject({
      command: "my-gcc",
      executable: "my-gcc",
      origin: "settings",
      originReason: "ユーザ直接指定",
    });
  });

  it("uses auto-detected gcc from PATH when settings are empty (origin: path, 自動検出)", () => {
    const ext = process.platform === "win32" ? ".exe" : "";
    const gccPath = join(binDir, `gcc${ext}`);
    writeFileSync(gccPath, "");
    if (process.platform !== "win32") chmodSync(gccPath, 0o755);

    const res = resolveCppCommand(undefined, { cppArgs: "-E" }, binDir);
    expect(res).toMatchObject({
      command: "gcc -E",
      executable: "gcc",
      fullPath: gccPath,
      origin: "path",
      originReason: "自動検出",
    });
  });

  // 未設定（undefined）のときだけ既定の引数を付ける。付けないと gcc がヘッダーをコンパイルして
  // 型エラーで終了コード 1 になり、ヘッダーの隣に .gch を書き出してしまう。空文字は「付けない」。
  it("defaults cppArgs to '-E -DTECSGEN' when cppArgs is unset (settings cppPath)", () => {
    const res = resolveCppCommand(undefined, { cppPath: "my-gcc" });
    expect(res).toMatchObject({ command: "my-gcc -E -DTECSGEN", executable: "my-gcc", origin: "settings" });
  });

  it("defaults cppArgs to '-E -DTECSGEN' for an auto-detected gcc when cppArgs is unset", () => {
    const ext = process.platform === "win32" ? ".exe" : "";
    const gccPath = join(binDir, `gcc${ext}`);
    writeFileSync(gccPath, "");
    if (process.platform !== "win32") chmodSync(gccPath, 0o755);

    const res = resolveCppCommand(undefined, {}, binDir);
    expect(res).toMatchObject({ command: "gcc -E -DTECSGEN", executable: "gcc", fullPath: gccPath, origin: "path" });
  });

  it("keeps an explicitly saved empty cppArgs empty and a whitespace-only value as empty", () => {
    expect(resolveCppCommand(undefined, { cppPath: "my-gcc", cppArgs: "" }).command).toBe("my-gcc");
    expect(resolveCppCommand(undefined, { cppPath: "my-gcc", cppArgs: "   " }).command).toBe("my-gcc");
  });

  it("quotes a path with spaces and still adds the default arguments", () => {
    const cppPath = "C:\Program Files\GNU\bin\gcc.exe";
    const res = resolveCppCommand(undefined, { cppPath });
    expect(splitCommand(res.command)).toEqual([cppPath, "-E", "-DTECSGEN"]);
  });

  it("falls back to default gcc when not found (origin: default, フォールバック)", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const res = resolveCppCommand(undefined, {}, emptyDir);
    expect(res).toMatchObject({
      command: "gcc -E -DTECSGEN",
      executable: "gcc",
      fullPath: "未検出 (PATH上)",
      origin: "default",
      originReason: "フォールバック",
    });
  });
});

describe("chooseCppPath", () => {
  it("returns selected file path on dialog confirm", async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: ["/usr/bin/gcc"] });
    const result = await chooseCppPath();
    expect(result).toBe("/usr/bin/gcc");
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "C プリプロセッサ実行ファイルの選択",
        properties: ["openFile"],
      }),
    );
  });

  it("returns null when dialog is canceled", async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const result = await chooseCppPath();
    expect(result).toBeNull();
  });
});

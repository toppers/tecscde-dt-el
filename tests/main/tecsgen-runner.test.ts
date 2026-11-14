// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節 — TecsgenRunner の単体テスト。
// child_process.execFile をモックし、成功・非0終了・実行ファイル未検出(ENOENT)の
// 3パターンを検証する。

import { afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import { access, mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TecsgenRunner, summarizeStderr } from "../../src/main/tecsgen-runner.js";
import type { ResolvedCppCommand } from "../../src/main/tool-settings.js";

const execFileMock = vi.fn();
const originalTecsgenCommand = process.env.TECSGEN_COMMAND;
const onWindows = process.platform === "win32";

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    // promisify(execFile) はコールバック形式を前提とするため、最後の引数がコールバック
    const cb = args[args.length - 1] as (err: unknown, result?: { stdout: string; stderr: string }) => void;
    execFileMock(...args.slice(0, -1)).then(
      (result: { stdout: string; stderr: string }) => cb(null, result),
      (err: unknown) => cb(err),
    );
  },
}));

describe("TecsgenRunner", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete process.env.TECSGEN_COMMAND;
  });

  afterAll(() => {
    if (originalTecsgenCommand === undefined) delete process.env.TECSGEN_COMMAND;
    else process.env.TECSGEN_COMMAND = originalTecsgenCommand;
  });

  it("uses a configured Ruby or Python command without shell interpolation", async () => {
    process.env.TECSGEN_COMMAND = 'ruby "C:\\Program Files\\tecsgen.rb"';
    execFileMock.mockResolvedValue({ stdout: "ok", stderr: "" });
    await new TecsgenRunner().run(["main.cdl"]);
    expect(execFileMock).toHaveBeenCalledWith(
      "ruby", ["C:\\Program Files\\tecsgen.rb", "main.cdl"], { timeout: 30_000, shell: false },
    );
  });

  it.each(["", "  ", '""', '"unclosed'])("does not execute a fallback for invalid explicit TECSGEN_COMMAND %j", async (value) => {
    process.env.TECSGEN_COMMAND = value;
    const runner = new TecsgenRunner();
    const result = await runner.run(["--version"]);
    expect(result.launchFailure?.kind).toBe("launch-error");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("uses the current provider for each new operation and fixes an in-flight command", async () => {
    let executable = "/first tool";
    const provider = vi.fn(async () => ({ executable, args: ["fixed-prefix"], source: "settings" as const }));
    const runner = new TecsgenRunner(provider);
    execFileMock.mockResolvedValue({ stdout: "1.9.1", stderr: "" });
    const first = runner.generate(["main.cdl"]);
    executable = "/second tool";
    await first;
    await runner.version();
    expect(execFileMock.mock.calls[0]?.slice(0, 2)).toEqual(["/first tool", ["fixed-prefix", "main.cdl"]]);
    expect(execFileMock.mock.calls[1]?.slice(0, 2)).toEqual(["/second tool", ["fixed-prefix", "--version"]]);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("captures the provider before Plugin temporary-file work starts", async () => {
    let executable = "/first tool";
    const provider = vi.fn(async () => ({ executable, args: [], source: "settings" as const }));
    const runner = new TecsgenRunner(provider);
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
    const pending = runner.generatedTypes(["main.cdl"], join(process.cwd(), "main.cdl"));
    executable = "/second tool";
    await pending;
    expect(execFileMock.mock.calls[0]?.[0]).toBe("/first tool");
    expect(provider).toHaveBeenCalledOnce();
  });

  it("freezes the default runner environment at construction", async () => {
    process.env.TECSGEN_COMMAND = "/startup/tool";
    const runner = new TecsgenRunner();
    process.env.TECSGEN_COMMAND = "/changed/tool";
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
    await runner.run([]);
    expect(execFileMock.mock.calls[0]?.[0]).toBe("/startup/tool");
  });

  it("associates successful and failed executions with the captured settings revision", async () => {
    const runner = new TecsgenRunner(async () => ({ executable: "/tool", args: [], source: "settings", revision: 4 }));
    execFileMock.mockResolvedValueOnce({ stdout: "ok", stderr: "" })
      .mockRejectedValueOnce(Object.assign(Error("missing"), { code: "ENOENT" }))
      .mockRejectedValueOnce(Object.assign(Error("failed"), { code: 2, stderr: "bad input" }));
    expect(await runner.generate([])).toMatchObject({ exitCode: 0, settingsRevision: 4 });
    expect(await runner.generate([])).toMatchObject({ executableFound: false, settingsRevision: 4 });
    expect(await runner.generate([])).toMatchObject({ exitCode: 2, settingsRevision: 4 });
  });

  it.skipIf(process.platform !== "win32")("uses the common explicit batch host for Generate, version and Plugin loading", async () => {
    const runner = new TecsgenRunner(async () => ({ executable: resolve("tests/fixtures/tecsgen-invocation/forward.bat"), args: ["prefix"], source: "settings" }));
    execFileMock.mockResolvedValue({ stdout: "version 1.9.1", stderr: "" });
    await runner.generate(["-c", 'gcc -I "C:\\Program Files\\include"']);
    await runner.version();
    await runner.generatedTypes(["main.cdl"], join(process.cwd(), "main.cdl"));
    expect(execFileMock).toHaveBeenCalledTimes(3);
    for (const [executable, args, options] of execFileMock.mock.calls) {
      expect(executable.toLowerCase()).toMatch(/\\system32\\cmd.exe$/);
      expect(args.slice(0, 4)).toEqual(["/d", "/s", "/v:off", "/c"]);
      expect(options).toMatchObject({ shell: false, windowsVerbatimArguments: true, windowsHide: true });
    }
  });

  it.skipIf(process.platform !== "win32")("hides the explicit PowerShell script host without bypassing execution policy", async () => {
    execFileMock.mockResolvedValue({ stdout: "version 1.9.1", stderr: "" });
    const runner = new TecsgenRunner(async () => ({ executable: resolve("tests/fixtures/tecsgen-invocation/capture.ps1"), args: [], source: "settings" }));
    await runner.version();
    const [executable, args, options] = execFileMock.mock.calls[0]!;
    expect(executable.toLowerCase()).toMatch(/\\(?:pwsh|powershell)\.exe$/);
    expect(args).toContain("-EncodedCommand");
    expect(args).not.toContain("-ExecutionPolicy");
    expect(options).toMatchObject({ shell: false, windowsHide: true });
  });

  it.skipIf(process.platform !== "win32").each(["bat", "ps1"])("reports a deleted saved absolute %s script as not-found without launching its host", async (extension) => {
    const dir = await mkdtemp(join(tmpdir(), "tecsgen-deleted-script-"));
    const path = join(dir, "tecsgen." + extension);
    try {
      await writeFile(path, extension === "bat" ? "@echo version 1.9.1" : "'version 1.9.1'");
      const runner = new TecsgenRunner(async () => ({ executable: path, args: [], source: "settings" }));
      await rm(path);
      execFileMock.mockResolvedValue({ stdout: "wrong fallback", stderr: "" });
      expect(await runner.version()).toMatchObject({ kind: "not-found" });
      expect(execFileMock).not.toHaveBeenCalled();
    } finally { await rmdir(dir); }
  });

  it.skipIf(process.platform !== "win32")("keeps unqualified environment batch commands for the host's PATH lookup", async () => {
    process.env.TECSGEN_COMMAND = "tecsgen.bat";
    execFileMock.mockResolvedValue({ stdout: "version 1.9.1", stderr: "" });
    expect(await new TecsgenRunner().version()).toMatchObject({ kind: "ok", text: "version 1.9.1" });
    expect(execFileMock.mock.calls[0]?.[1].at(-1)).toContain("tecsgen.bat");
  });

  it("generatedTypes() reads all generated CDL and removes its temporary output", async () => {
    let outputDir = "";
    execFileMock.mockImplementation(async (_command: string, args: readonly string[], options: { cwd: string }) => {
      outputDir = args[1]!;
      expect(args[0]).toBe("-g");
      expect(options.cwd).toBe(process.cwd());
      await mkdir(join(outputDir, "nested"));
      await writeFile(join(outputDir, "tmp_Plugin_0.cdl"), "celltype tOne {};", "utf8");
      await writeFile(join(outputDir, "nested", "other.cdl"), "celltype tTwo {};", "utf8");
      await writeFile(join(outputDir, "generated.c"), "ignored", "utf8");
      return { stdout: "ok", stderr: "" };
    });
    const result = await new TecsgenRunner().generatedTypes(["main.cdl"], join(process.cwd(), "main.cdl"));
    expect(result.result.exitCode).toBe(0);
    expect(result.sources.map((source) => source.fileName).sort()).toEqual(["nested/other.cdl", "tmp_Plugin_0.cdl"]);
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("generatedTypes() uses the original options and isolates their output directory", async () => {
    const optionsDir = await mkdtemp(join(tmpdir(), "tecscde-options-test-"));
    const optionsFilePath = join(optionsDir, "input.tecsgen-opts");
    try {
      await writeFile(optionsFilePath, '-I ./includes -L "user plugins" -D FLAG=1 -g old-gen main.cdl', "utf8");
      execFileMock.mockResolvedValue({ stdout: "ok", stderr: "" });
      const runner = new TecsgenRunner();
      await runner.generatedTypes(["ignored.cdl"], join(optionsDir, "main.cdl"), optionsFilePath);
      const [command, args, options] = execFileMock.mock.calls[0]!;
      expect(command).toBe("tecsgen");
      expect(options.cwd).toBe(optionsDir);
      expect(args[0]).toBe("-g");
      // オプションファイルに`-k`が無いので、`-g <dir>`の直後に`-k utf8`が足される。
      expect(args.slice(2)).toEqual(["-k", "utf8", "-I", "./includes", "-L", "user plugins", "-D", "FLAG=1", "main.cdl"]);
    } finally {
      await rm(optionsFilePath, { force: true });
      await rmdir(optionsDir);
    }
  });

  // tecsgen本体は`-S`を持たない（アプリ独自。外部仕様5.3・8.x）。そのまま渡すと`-S`をファイル名と取り違えて
  // 失敗し、Plugin生成型が読み込まれない。`-I`に置き換えて、記述順を保つ。
  it.each([
    ["-S <dir>", "-S ./sys -I ./inc -S ./lib main.cdl", ["-I", "./sys", "-I", "./inc", "-I", "./lib", "main.cdl"]],
    ["-S<dir> (attached)", "-S./sys -I./inc main.cdl", ["-I", "./sys", "-I./inc", "main.cdl"]],
    ["--system-dir <dir>", "--system-dir ./sys main.cdl", ["-I", "./sys", "main.cdl"]],
    ["--system-dir=<dir>", "--system-dir=./sys main.cdl", ["-I", "./sys", "main.cdl"]],
  ])("generatedTypes() passes %s to tecsgen as -I, keeping the order", async (_label, text, expected) => {
    const optionsDir = await mkdtemp(join(tmpdir(), "tecscde-options-s-"));
    const optionsFilePath = join(optionsDir, "s.tecsgen-opts");
    try {
      await writeFile(optionsFilePath, text, "utf8");
      execFileMock.mockResolvedValue({ stdout: "ok", stderr: "" });
      await new TecsgenRunner().generatedTypes(["ignored.cdl"], join(optionsDir, "main.cdl"), optionsFilePath);
      const [, args] = execFileMock.mock.calls[0]!;
      expect(args.slice(4)).toEqual(expected); // ["-g", dir, "-k", "utf8", ...]
      expect(args).not.toContain("-S");
      expect(args).not.toContain("--system-dir");
      expect(args.some((arg: string) => arg.startsWith("-S") || arg.startsWith("--system-dir"))).toBe(false);
    } finally {
      await rm(optionsFilePath, { force: true });
      await rmdir(optionsDir);
    }
  });

  describe.each([
    ["-k euc", ["-k", "euc"]],
    ["--kcode sjis", ["--kcode", "sjis"]],
    ["--kcode=none", ["--kcode=none"]],
    ["-ksjis (attached)", ["-ksjis"]],
  ])("generatedTypes() with an options file that already has %s", (_label, kArgs) => {
    it("keeps the file's -k and does not add -k utf8", async () => {
      const optionsDir = await mkdtemp(join(tmpdir(), "tecscde-options-k-"));
      const optionsFilePath = join(optionsDir, "k.tecsgen-opts");
      try {
        await writeFile(optionsFilePath, `${kArgs.join(" ")} main.cdl`, "utf8");
        execFileMock.mockResolvedValue({ stdout: "ok", stderr: "" });
        await new TecsgenRunner().generatedTypes(["ignored.cdl"], join(optionsDir, "main.cdl"), optionsFilePath);
        const [, args] = execFileMock.mock.calls[0]!;
        expect(args.slice(2)).toEqual([...kArgs, "main.cdl"]);
        expect(args).not.toContain("utf8");
      } finally {
        await rm(optionsFilePath, { force: true });
        await rmdir(optionsDir);
      }
    });
  });

  it("run() returns exitCode 0 and executableFound=true on success", async () => {
    execFileMock.mockResolvedValue({ stdout: "generated ok", stderr: "" });
    const runner = new TecsgenRunner();

    const result = await runner.run(["-c", "main.cde"]);

    expect(result).toEqual({ stdout: "generated ok", stderr: "", exitCode: 0, executableFound: true });
  });

  it("run() reports executableFound=false on ENOENT (tecsgen not on PATH, 11.2節#3)", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoent);
    const runner = new TecsgenRunner();

    const result = await runner.run(["--version"]);

    expect(result).toEqual({
      stdout: "", stderr: "", exitCode: null, executableFound: false,
      launchFailure: { kind: "not-found", command: "tecsgen", detail: "ENOENT" },
    });
  });

  it("run() names TECSGEN_COMMAND's executable when that command is not found", async () => {
    process.env.TECSGEN_COMMAND = "ruby /opt/tecsgen.rb";
    execFileMock.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));

    const result = await new TecsgenRunner().run(["--version"]);

    expect(result.executableFound).toBe(false);
    expect(result.launchFailure).toMatchObject({ kind: "not-found", command: "ruby" });
  });

  it.each([
    ["EACCES", { code: "EACCES" }, "permission"],
    ["EPERM", { code: "EPERM" }, "permission"],
    ["timeout (killed)", { code: null, killed: true, signal: "SIGTERM" }, "timeout"],
    ["maxBuffer", { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }, "output-overflow"],
    ["other launch error", { code: "E2BIG" }, "launch-error"],
  ])("run() classifies %s as a launch failure, not an exit code", async (_name, props, kind) => {
    execFileMock.mockRejectedValue(Object.assign(new Error("boom"), props, { stdout: "partial", stderr: "" }));

    const result = await new TecsgenRunner().run(["main.cdl"]);

    expect(result.executableFound).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe("partial");
    expect(result.launchFailure).toMatchObject({ kind, command: "tecsgen" });
  });

  it("run() reports an empty TECSGEN_COMMAND as a launch error", async () => {
    process.env.TECSGEN_COMMAND = '""';

    const result = await new TecsgenRunner().run(["main.cdl"]);

    expect(result.launchFailure).toMatchObject({ kind: "launch-error" });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("run() preserves stdout/stderr even when tecsgen exits non-zero (syntax/semantic error)", async () => {
    const failure = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "partial output",
      stderr: "E1234: syntax error",
    });
    execFileMock.mockRejectedValue(failure);
    const runner = new TecsgenRunner();

    const result = await runner.run(["-c", "broken.cde"]);

    expect(result).toEqual({
      stdout: "partial output",
      stderr: "E1234: syntax error",
      exitCode: 1,
      executableFound: true,
    });
  });

  it("version() returns the trimmed stdout as an ok result", async () => {
    execFileMock.mockResolvedValue({ stdout: "1.9.1\n", stderr: "" });
    const runner = new TecsgenRunner();

    await expect(runner.version()).resolves.toEqual({ kind: "ok", text: "1.9.1", command: "tecsgen" });
  });

  it("preprocess() runs preprocessor with default or custom command", async () => {
    execFileMock.mockResolvedValue({ stdout: "typedef int INT;", stderr: "" });
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h");
    expect(result).toMatchObject({ stdout: "typedef int INT;", stderr: "", exitCode: 0, executableFound: true });
    expect(execFileMock).toHaveBeenCalledWith("gcc", ["-E", "-DTECSGEN", "header.h"], expect.objectContaining({ timeout: 30_000 }));

    execFileMock.mockResolvedValue({ stdout: "struct S {};", stderr: "" });
    const customResult = await runner.preprocess("header.h", "clang -E");
    expect(customResult).toMatchObject({ stdout: "struct S {};", stderr: "", exitCode: 0, executableFound: true });
    expect(execFileMock).toHaveBeenCalledWith("clang", ["-E", "header.h"], expect.objectContaining({ timeout: 30_000 }));
  });

  it("preprocess() passes include dirs as absolute -I options, without duplicates", async () => {
    execFileMock.mockResolvedValue({ stdout: "expanded", stderr: "" });
    const runner = new TecsgenRunner();

    await runner.preprocess("header.h", undefined, ["inc", "inc", "other/../third"]);

    expect(execFileMock).toHaveBeenCalledWith(
      "gcc",
      ["-E", "-DTECSGEN", `-I${resolve("inc")}`, `-I${resolve("third")}`, "header.h"],
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it("preprocess() keeps quoted executable paths and option values intact", async () => {
    execFileMock.mockResolvedValue({ stdout: "expanded", stderr: "" });
    const runner = new TecsgenRunner();

    await runner.preprocess("C:\\headers\\my header.h", '"C:\\Program Files\\LLVM\\bin\\clang.exe" -E -DNAME="two words"');

    expect(execFileMock).toHaveBeenCalledWith(
      "C:\\Program Files\\LLVM\\bin\\clang.exe",
      ["-E", "-DNAME=two words", "C:\\headers\\my header.h"],
      onWindows ? { timeout: 30_000, env: expect.any(Object) } : { timeout: 30_000 },
    );
  });

  it("preprocess() reports an unmatched quote as a command failure", async () => {
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h", '"C:\\Program Files\\clang.exe -E');

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 1, executableFound: true, failureKind: "failed" });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("preprocess() returns executableFound=false on ENOENT", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoent);
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: null, executableFound: false, failureKind: "not-found" });
  });

  it("preprocess() returns structured not-found failure on ENOENT", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoent);
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h", "custom-gcc -E");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: null,
      executableFound: false,
      command: "custom-gcc -E",
      originReason: "ユーザ直接指定",
      failureKind: "not-found",
      failureDetail: "'custom-gcc' が見つかりません",
    });
    expect(result.fullPath).toBeDefined();
  });

  it("preprocess() returns structured failed failure with summarized stderr excerpt", async () => {
    const multiLineStderr = [
      "In file included from header.h:1:",
      "fatal error: sub.h: No such file or directory",
      "compilation terminated.",
    ].join("\n");
    const failedErr = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: multiLineStderr,
    });
    execFileMock.mockRejectedValue(failedErr);
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h", "gcc -E");
    expect(result).toMatchObject({
      exitCode: 1,
      executableFound: true,
      command: "gcc -E",
      originReason: "ユーザ直接指定",
      failureKind: "failed",
      failureDetail: "終了コード 1: In file included from header.h:1: fatal error: sub.h: No such file or directory compilation terminated.",
    });

    // 200文字上限の切り詰め検証
    const longStderr = "x".repeat(300);
    execFileMock.mockRejectedValue(Object.assign(new Error("exit 2"), {
      code: 2,
      stderr: longStderr,
    }));
    const longResult = await runner.preprocess("header.h", "gcc -E");
    expect(longResult.failureKind).toBe("failed");
    expect(longResult.failureDetail).toBe(`終了コード 2: ${"x".repeat(200)}`);
  });

  it("preprocess() returns structured timeout failure on process timeout", async () => {
    const timeoutErr = Object.assign(new Error("Process timed out"), {
      killed: true,
      signal: "SIGTERM",
      stdout: "partial output",
      stderr: "timeout occurred",
    });
    execFileMock.mockRejectedValue(timeoutErr);
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h", "gcc -E");
    expect(result).toMatchObject({
      stdout: "partial output",
      stderr: "timeout occurred",
      exitCode: null,
      executableFound: true,
      command: "gcc -E",
      originReason: "ユーザ直接指定",
      failureKind: "timeout",
      failureDetail: "30秒以内に完了しなかったためタイムアウトしました",
    });
  });

  it("preprocess() accepts ResolvedCppCommand and preserves originReason and fullPath", async () => {
    execFileMock.mockResolvedValue({ stdout: "typedef int INT;", stderr: "" });
    const runner = new TecsgenRunner();

    const resolved: ResolvedCppCommand = {
      command: "arm-none-eabi-gcc -E -DTECSGEN",
      executable: "arm-none-eabi-gcc",
      fullPath: "C:\\msys64\\bin\\arm-none-eabi-gcc.exe",
      origin: "path",
      originReason: "自動検出",
    };

    const result = await runner.preprocess("header.h", resolved);
    expect(result).toEqual({
      stdout: "typedef int INT;",
      stderr: "",
      exitCode: 0,
      executableFound: true,
      command: "arm-none-eabi-gcc -E -DTECSGEN",
      originReason: "自動検出",
      fullPath: "C:\\msys64\\bin\\arm-none-eabi-gcc.exe",
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "arm-none-eabi-gcc",
      ["-E", "-DTECSGEN", "header.h"],
      onWindows ? { timeout: 30_000, env: expect.any(Object) } : { timeout: 30_000 },
    );
  });

  // MSYS2 の gcc.exe は子プロセス cc1.exe を PATH 上の最初の DLL で起動する。PATH 上で先に
  // 別ツール同梱の古い DLL（例: Meld）があると、標準エラー出力なしで終了コード 1 になる。
  // gcc 自身のディレクトリを PATH の先頭へ足して、その衝突を避ける。
  describe.skipIf(!onWindows)("preprocess() puts the compiler's own directory first on PATH (Windows)", () => {
    const resolved: ResolvedCppCommand = {
      command: "gcc -E -DTECSGEN",
      executable: "gcc",
      fullPath: "C:\\msys64\\ucrt64\\bin\\gcc.exe",
      origin: "path",
      originReason: "自動検出",
    };
    const pathOf = (options: { env?: NodeJS.ProcessEnv }): string => {
      const key = Object.keys(options.env ?? {}).find((k) => k.toLowerCase() === "path");
      return key === undefined ? "" : (options.env![key] ?? "");
    };

    it("prepends the directory of the resolved full path", async () => {
      execFileMock.mockResolvedValue({ stdout: "x", stderr: "" });
      await new TecsgenRunner().preprocess("header.h", resolved);
      const options = execFileMock.mock.calls[0]![2] as { timeout: number; env?: NodeJS.ProcessEnv };
      expect(options.timeout).toBe(30_000);
      expect(pathOf(options).startsWith("C:\\msys64\\ucrt64\\bin;")).toBe(true);
      expect(pathOf(options)).toContain(process.env.PATH ?? process.env.Path ?? "");
    });

    it("prepends the directory of an absolute executable written in the command", async () => {
      execFileMock.mockResolvedValue({ stdout: "x", stderr: "" });
      await new TecsgenRunner().preprocess("header.h", '"C:\\tools\\llvm\\bin\\clang.exe" -E');
      const options = execFileMock.mock.calls[0]![2] as { env?: NodeJS.ProcessEnv };
      expect(pathOf(options).startsWith("C:\\tools\\llvm\\bin;")).toBe(true);
    });

    it("leaves the environment alone when the compiler path is unknown", async () => {
      execFileMock.mockResolvedValue({ stdout: "x", stderr: "" });
      await new TecsgenRunner().preprocess("header.h", { ...resolved, fullPath: "未検出 (PATH上)" });
      expect(execFileMock.mock.calls[0]![2]).toEqual({ timeout: 30_000 });
    });

    it("does not modify process.env", async () => {
      const before = process.env.PATH ?? process.env.Path;
      execFileMock.mockResolvedValue({ stdout: "x", stderr: "" });
      await new TecsgenRunner().preprocess("header.h", resolved);
      expect(process.env.PATH ?? process.env.Path).toBe(before);
    });
  });

  describe("summarizeStderr", () => {
    it("handles empty and whitespace-only strings", () => {
      expect(summarizeStderr("")).toBe("");
      expect(summarizeStderr("   \n\n  \t  ")).toBe("");
    });

    it("joins non-empty lines with spaces", () => {
      expect(summarizeStderr("line 1\n  \nline 2\r\nline 3")).toBe("line 1 line 2 line 3");
    });

    it("truncates at maxLen", () => {
      expect(summarizeStderr("abcdefghij", 5)).toBe("abcde");
    });
  });

  describe("generate() (外部仕様5.3節: 作業ディレクトリ)", () => {
    it("keeps the Generate limits (30s, default maxBuffer) without a cwd", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
      await new TecsgenRunner().generate(["-I", "inc", "main.cdl"]);
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["-I", "inc", "main.cdl"], { timeout: 30_000, shell: false });
    });

    it("runs in the given directory with the same Generate limits (not the looser plugin-load limits)", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
      await new TecsgenRunner().generate(["main.cdl"], "/proj/opts");
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["main.cdl"], { timeout: 30_000, cwd: "/proj/opts", shell: false });
    });
  });

  describe("version() (9C.2節)", () => {
    it("reads the version from stderr when stdout is empty (tecsgen prints its banner to stderr)", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "tecsgen  version 1.9.1  \n" });
      expect(await new TecsgenRunner().version()).toEqual({ kind: "ok", text: "tecsgen  version 1.9.1", command: "tecsgen" });
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["--version"], { timeout: 30_000, shell: false });
    });

    it("prefers stdout when it has text", async () => {
      execFileMock.mockResolvedValue({ stdout: "tecsgen 2.0.0\n", stderr: "warning" });
      expect(await new TecsgenRunner().version()).toEqual({ kind: "ok", text: "tecsgen 2.0.0", command: "tecsgen" });
    });

    it("returns an empty text when both streams are empty", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
      expect(await new TecsgenRunner().version()).toEqual({ kind: "ok", text: "", command: "tecsgen" });
    });

    it("reports not-found on ENOENT", async () => {
      execFileMock.mockRejectedValue(Object.assign(new Error("nf"), { code: "ENOENT" }));
      expect(await new TecsgenRunner().version()).toEqual({ kind: "not-found", command: "tecsgen" });
    });

    it("reports a launch failure other than ENOENT as failed", async () => {
      execFileMock.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
      expect(await new TecsgenRunner().version()).toEqual({ kind: "failed", detail: "permission: EACCES", command: "tecsgen" });
    });

    it("reports a non-zero exit as failed", async () => {
      execFileMock.mockRejectedValue(Object.assign(new Error("bad"), { code: 2, stdout: "", stderr: "x" }));
      expect(await new TecsgenRunner().version()).toEqual({ kind: "failed", detail: "終了コード 2: x", command: "tecsgen" });
    });

    it("keeps a bounded host failure reason and uses stdout if stderr is empty", async () => {
      execFileMock.mockRejectedValueOnce(Object.assign(new Error("policy"), { code: 1, stdout: "", stderr: "policy: " + "x".repeat(2000) }));
      const policy = await new TecsgenRunner().version();
      expect(policy.kind).toBe("failed");
      if (policy.kind === "failed") {
        expect(policy.detail).toContain("policy:");
        expect(policy.detail.length).toBe("終了コード 1: ".length + 1000);
      }
      execFileMock.mockRejectedValueOnce(Object.assign(new Error("out"), { code: 3, stdout: " host denied ", stderr: " " }));
      expect(await new TecsgenRunner().version()).toEqual({ kind: "failed", detail: "終了コード 3: host denied", command: "tecsgen" });
      execFileMock.mockRejectedValueOnce(Object.assign(new Error("empty"), { code: 4 }));
      expect(await new TecsgenRunner().version()).toEqual({ kind: "failed", detail: "終了コード 4", command: "tecsgen" });
    });
  });
});

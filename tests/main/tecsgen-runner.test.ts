// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節 — TecsgenRunner の単体テスト。
// child_process.execFile をモックし、成功・非0終了・実行ファイル未検出(ENOENT)の
// 3パターンを検証する。

import { afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import { access, mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TecsgenRunner } from "../../src/main/tecsgen-runner.js";

const execFileMock = vi.fn();
const originalTecsgenCommand = process.env.TECSGEN_COMMAND;

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
      "ruby", ["C:\\Program Files\\tecsgen.rb", "main.cdl"], { timeout: 30_000 },
    );
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
    expect(result).toEqual({ stdout: "typedef int INT;", stderr: "", exitCode: 0, executableFound: true });
    expect(execFileMock).toHaveBeenCalledWith("gcc", ["-E", "-DTECSGEN", "header.h"], { timeout: 30_000 });

    execFileMock.mockResolvedValue({ stdout: "struct S {};", stderr: "" });
    const customResult = await runner.preprocess("header.h", "clang -E");
    expect(customResult).toEqual({ stdout: "struct S {};", stderr: "", exitCode: 0, executableFound: true });
    expect(execFileMock).toHaveBeenCalledWith("clang", ["-E", "header.h"], { timeout: 30_000 });
  });

  it("preprocess() passes include dirs as absolute -I options, without duplicates", async () => {
    execFileMock.mockResolvedValue({ stdout: "expanded", stderr: "" });
    const runner = new TecsgenRunner();

    await runner.preprocess("header.h", undefined, ["inc", "inc", "other/../third"]);

    expect(execFileMock).toHaveBeenCalledWith(
      "gcc",
      ["-E", "-DTECSGEN", `-I${resolve("inc")}`, `-I${resolve("third")}`, "header.h"],
      { timeout: 30_000 },
    );
  });

  it("preprocess() keeps quoted executable paths and option values intact", async () => {
    execFileMock.mockResolvedValue({ stdout: "expanded", stderr: "" });
    const runner = new TecsgenRunner();

    await runner.preprocess("C:\\headers\\my header.h", '"C:\\Program Files\\LLVM\\bin\\clang.exe" -E -DNAME="two words"');

    expect(execFileMock).toHaveBeenCalledWith(
      "C:\\Program Files\\LLVM\\bin\\clang.exe",
      ["-E", "-DNAME=two words", "C:\\headers\\my header.h"],
      { timeout: 30_000 },
    );
  });

  it("preprocess() reports an unmatched quote as a command failure", async () => {
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h", '"C:\\Program Files\\clang.exe -E');

    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 1, executableFound: true });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("preprocess() returns executableFound=false on ENOENT", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoent);
    const runner = new TecsgenRunner();

    const result = await runner.preprocess("header.h");
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: null, executableFound: false });
  });

  describe("generate() (外部仕様5.3節: 作業ディレクトリ)", () => {
    it("keeps the Generate limits (30s, default maxBuffer) without a cwd", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
      await new TecsgenRunner().generate(["-I", "inc", "main.cdl"]);
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["-I", "inc", "main.cdl"], { timeout: 30_000 });
    });

    it("runs in the given directory with the same Generate limits (not the looser plugin-load limits)", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
      await new TecsgenRunner().generate(["main.cdl"], "/proj/opts");
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["main.cdl"], { timeout: 30_000, cwd: "/proj/opts" });
    });
  });

  describe("version() (9C.2節)", () => {
    it("reads the version from stderr when stdout is empty (tecsgen prints its banner to stderr)", async () => {
      execFileMock.mockResolvedValue({ stdout: "", stderr: "tecsgen  version 1.9.1  \n" });
      expect(await new TecsgenRunner().version()).toEqual({ kind: "ok", text: "tecsgen  version 1.9.1", command: "tecsgen" });
      expect(execFileMock).toHaveBeenCalledWith("tecsgen", ["--version"], { timeout: 30_000 });
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
      expect(await new TecsgenRunner().version()).toEqual({ kind: "failed", detail: "終了コード 2", command: "tecsgen" });
    });

    it("reports the command that was used (TECSGEN_COMMAND), for the version dialog (3.8)", async () => {
      process.env.TECSGEN_COMMAND = "ruby /opt/tecsgen.rb";
      execFileMock.mockResolvedValue({ stdout: "tecsgen 1.9.1\n", stderr: "" });
      expect(await new TecsgenRunner().version()).toEqual({ kind: "ok", text: "tecsgen 1.9.1", command: "ruby /opt/tecsgen.rb" });
      expect(execFileMock).toHaveBeenCalledWith("ruby", ["/opt/tecsgen.rb", "--version"], { timeout: 30_000 });
    });
  });
});

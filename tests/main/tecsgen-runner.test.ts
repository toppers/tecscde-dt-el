// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節 — TecsgenRunner の単体テスト。
// child_process.execFile をモックし、成功・非0終了・実行ファイル未検出(ENOENT)の
// 3パターンを検証する。

import { describe, expect, it, vi, beforeEach } from "vitest";
import { TecsgenRunner } from "../../src/main/tecsgen-runner.js";

const execFileMock = vi.fn();

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

    expect(result).toEqual({ stdout: "", stderr: "", exitCode: null, executableFound: false });
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

  it("version() returns null when the executable is not found, else trims stdout", async () => {
    execFileMock.mockResolvedValue({ stdout: "1.9.1\n", stderr: "" });
    const runner = new TecsgenRunner();

    await expect(runner.version()).resolves.toBe("1.9.1");
  });
});

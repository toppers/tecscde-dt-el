import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTecsgenInvocation, resolvePowerShellScriptHost } from "../../src/main/tecsgen-invocation.js";
import { resolveTecsgenCommand } from "../../src/main/tecsgen-path-resolver.js";

const execute = promisify(execFile);
const fixture = resolve("tests/fixtures/tecsgen-invocation");

describe("Windows tecsgen discovery policy", () => {
  it("prefers the first PATH directory, then bat before ps1 within that directory", async () => {
    const existing = new Set(["C:\\first\\tecsgen.ps1", "C:\\second\\tecsgen.bat"]);
    const exists = async (path: string) => existing.has(path);
    expect(await resolveTecsgenCommand({ PATH: "C:\\first;C:\\second" }, "", { platform: "win32", exists }))
      .toMatchObject({ executable: "C:\\first\\tecsgen.ps1", source: "path" });
    existing.add("C:\\first\\tecsgen.bat");
    expect(await resolveTecsgenCommand({ PATH: "C:\\first;C:\\second" }, "", { platform: "win32", exists }))
      .toMatchObject({ executable: "C:\\first\\tecsgen.bat", source: "path" });
  });
  it("does not discover tecsgen.exe on Windows", async () => {
    expect(await resolveTecsgenCommand({ PATH: "C:\\bin" }, "", {
      platform: "win32", exists: async (path) => path === "C:\\bin\\tecsgen.exe",
    })).toMatchObject({ source: "missing" });
  });
});

describe("tecsgen invocation", () => {
  it("prefers an installed PowerShell 7 host and retains Windows PowerShell as the fallback", () => {
    const environment = { PATH: "C:\\first;C:\\second", SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Programs" };
    expect(resolvePowerShellScriptHost(environment, (path) => path === "C:\\second\\pwsh.exe")).toBe("C:\\second\\pwsh.exe");
    expect(resolvePowerShellScriptHost(environment, () => false)).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });
  it("keeps native executables and non-Windows invocations as literal argv", () => {
    expect(createTecsgenInvocation({ executable: "/bin/tecsgen", args: ["prefix"], source: "settings" }, ["one arg", ""], "linux"))
      .toEqual({ executable: "/bin/tecsgen", args: ["prefix", "one arg", ""] });
  });
  it("rejects values cmd cannot faithfully represent before starting a batch process", () => {
    for (const value of ["line\nnext", "line\rnext", "nul\0value", "C:\\Program Files\\"]) {
      expect(() => createTecsgenInvocation({ executable: "C:\\tool.bat", args: [], source: "settings" }, [value], "win32")).toThrow();
    }
  });
  it("rejects overlong Windows host command lines instead of risking truncation", () => {
    expect(() => createTecsgenInvocation({ executable: "C:\\tool.bat", args: [], source: "settings" }, ["x".repeat(8200)], "win32")).toThrow(/長/);
    expect(() => createTecsgenInvocation({ executable: "C:\\tool.ps1", args: [], source: "settings" }, ["x".repeat(25000)], "win32")).toThrow(/長/);
  });

  describe.skipIf(process.platform !== "win32")("real Windows hosts", () => {
    async function withFixture(run: (dir: string) => Promise<void>) {
      const dir = await fs.mkdtemp(join(tmpdir(), "tecs invocation [x]&%TECSCDE_TEST_EXPAND%-"));
      try {
        for (const name of ["forward.bat", "branch.bat", "capture.ps1", "capture.cjs"]) await fs.copyFile(join(fixture, name), join(dir, name));
        await run(dir);
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    }
    const common = ["", "with spaces", 'gcc -E -I "C:\\Program Files\\include"',
      'gcc -I "C:\\A&B"', 'abc" &echo INJECTED &rem "', "x|y", "<a>", "(x)", "caret^", "%TECSCDE_TEST_EXPAND%", "!bang!", "日本語", "tail\\", 'slash\\\"quote'];

    it("preserves the complete native argv through a batch forwarder without command injection", async () => {
      await withFixture(async (dir) => {
        const plan = createTecsgenInvocation({ executable: join(dir, "forward.bat"), args: ["fixed-prefix"], source: "settings" }, common);
        const { stdout } = await execute(plan.executable, [...plan.args], {
          shell: false, windowsVerbatimArguments: plan.windowsVerbatimArguments,
          env: { ...process.env, ...plan.env, TECSCDE_TEST_NODE: process.execPath, TECSCDE_TEST_EXPAND: "WRONG-EXPANSION" },
        });
        expect(JSON.parse(stdout)).toEqual(["fixed-prefix", ...common]);
      });
    });
    it.each([
      ["--version", "version 1.9.1"],
      ["with spaces", "space-match"],
      ["C:\\Program Files\\include", "path-match"],
      ["", "empty-match"],
    ])("keeps ordinary batch percent-tilde-1 branching valid for %j", async (argument, expected) => {
      await withFixture(async (dir) => {
        const plan = createTecsgenInvocation({ executable: join(dir, "branch.bat"), args: [], source: "settings" }, [argument]);
        const { stdout } = await execute(plan.executable, [...plan.args], {
          shell: false, windowsVerbatimArguments: plan.windowsVerbatimArguments, windowsHide: true,
        });
        expect(stdout.trim()).toBe(expected);
      });
    });
    it("preserves the complete argv, including multiline strings, through Windows PowerShell", async () => {
      await withFixture(async (dir) => {
        const values = [...common, "line\nnext", "line\r\nnext", "single'quote"];
        const plan = createTecsgenInvocation({ executable: join(dir, "capture.ps1"), args: [], source: "settings" }, values);
        const { stdout } = await execute(plan.executable, [...plan.args], { shell: false, env: { ...process.env, ...plan.env } });
        expect(JSON.parse(stdout.replace(/^\uFEFF/, ""))).toEqual(values);
      });
    });
    it("loads a UTF-8 launcher and keeps its script root when PowerShell 7 is installed", async () => {
      await withFixture(async (dir) => {
        const script = join(dir, "unicode.ps1");
        await fs.writeFile(script, "$ErrorActionPreference='Stop'\n$note='日本語の起動スクリプト'\nWrite-Output ('tecsgen version 1.9.1 ' + (Split-Path $PSCommandPath -Leaf))\n", "utf8");
        const plan = createTecsgenInvocation({ executable: script, args: [], source: "settings" }, []);
        const { stdout } = await execute(plan.executable, [...plan.args], { shell: false, windowsHide: true });
        expect(stdout.trim()).toContain("tecsgen version 1.9.1 unicode.ps1");
      });
    });
    it.each(["bat", "ps1"])("preserves a selected %s script's nonzero exit code", async (extension) => {
      await withFixture(async (dir) => {
        const path = join(dir, "exit." + extension);
        await fs.writeFile(path, extension === "bat" ? "@exit /b 7\r\n" : "exit 7\n");
        const plan = createTecsgenInvocation({ executable: path, args: [], source: "settings" }, []);
        await expect(execute(plan.executable, [...plan.args], {
          shell: false, windowsVerbatimArguments: plan.windowsVerbatimArguments, env: { ...process.env, ...plan.env },
        })).rejects.toMatchObject({ code: 7 });
      });
    });
  });
});

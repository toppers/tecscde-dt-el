import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { formatTecsgenCommand } from "../../src/main/tecsgen-command-copy.js";
import type { ResolvedTecsgenCommand } from "../../src/shared/ipc-types.js";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const shells = ["powershell7", "powershell5", "cmd"] as const;
const windows = process.platform === "win32";
const exec = (text: string, shell: typeof shells[number], cwd: string) => {
  // stdin is exactly the text pasted at the cmd prompt; /c through Node's CRT
  // argv quoting would add backslashes before the command's literal quotes.
  if (shell === "cmd") execFileSync("cmd.exe", ["/d", "/v:on", "/q"], {
    cwd, input: `${text}\r\nexit\r\n`, windowsHide: true, stdio: "pipe",
  });
  else execFileSync(shell === "powershell7" ? "pwsh.exe" : "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", text], { cwd, windowsHide: true, stdio: "pipe" });
};

describe("tecsgen command copy", () => {
  it("rejects unknown shell policies and commands that cannot be executed", () => {
    const valid: ResolvedTecsgenCommand = { executable: process.execPath, args: [], source: "settings" };
    expect(() => formatTecsgenCommand(valid, [], "unresolved" as never)).toThrow();
    expect(() => formatTecsgenCommand({ ...valid, executable: "", source: "invalid" }, [], "powershell7")).toThrow();
    expect(() => formatTecsgenCommand(valid, ["nul\0byte"], "cmd")).toThrow();
  });

  it.each(shells)("rejects overlong %s commands explicitly instead of truncating data", (shell) => {
    const command: ResolvedTecsgenCommand = { executable: process.execPath, args: [], source: "settings" };
    expect(() => formatTecsgenCommand(command, ["\\".repeat(40_000) + "x"], shell)).toThrow(/長|length/i);
  });

  it.skipIf(!windows).each(shells)("round-trips native argv and cwd through the actual %s parser", (shell) => {
    const root = mkdtempSync(join(tmpdir(), "tecscde-copy-日本語 % ! & "));
    temporary.push(root);
    const recorder = join(root, "argv recorder.mjs");
    const output = join(root, "received.json");
    writeFileSync(recorder, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv.slice(3), cwd: process.cwd() }));");
    const prefix = [recorder, output, "prefix argument"];
    const args = ["", "plain", "two words", "日本語😀", "a\"b", "'single'", "trailing\\", "space trailing\\", "\\\"", "%PATH%", "!bang!", "a&b|c<d>e^f", "$(Write-Error 'must not execute')", "`backtick`", "line1\nline2", "CR\rLF\r\nend", "\\".repeat(256) + "x"];
    const before = [...args];
    const command: ResolvedTecsgenCommand = { executable: process.execPath, args: prefix, source: "settings" };
    const copied = formatTecsgenCommand(command, args, shell, root);
    expect(copied).not.toContain("\n");
    exec(copied, shell, tmpdir());
    const result = JSON.parse(readFileSync(output, "utf-8"));
    expect(result).toEqual({ argv: ["prefix argument", ...args], cwd: root });
    expect(args).toEqual(before);
    expect(command.args).toEqual(prefix);
  }, 20_000);

  it.skipIf(!windows).each(shells)("round-trips a typical ps1 path/cpp invocation copied to %s", (shell) => {
    const root = mkdtempSync(join(tmpdir(), "tecscde-copy ps1-日本語-"));
    temporary.push(root);
    const script = join(root, "tecsgen entry point.ps1");
    const output = join(root, "received.json");
    writeFileSync(script, "param([string]$OutputFile)\r\n[IO.File]::WriteAllText($OutputFile,(ConvertTo-Json -InputObject @{argv=@($args);cwd=(Get-Location).ProviderPath} -Compress -Depth 5))\r\n", "utf8");
    const args = ["-k", "utf8", "-c", 'gcc -E -I "C:\\Program Files\\TECS\\include" -DNAME="日本語"', "", "%PATH%", "!bang!", "a\"&b|c", "line1\r\nline2", "trailing\\", "C:\\Users\\日本語 user\\TECS Project\\main.cdl"];
    const copied = formatTecsgenCommand({ executable: script, args: [output], source: "settings" }, args, shell, root);
    expect(copied.length).toBeLessThan(shell === "cmd" ? 8192 : 32701);
    exec(copied, shell, tmpdir());
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ argv: args, cwd: root });
  }, 20_000);

  it.skipIf(!windows).each(shells)("round-trips batch argv copied to %s without executing metacharacters", (shell) => {
    const root = mkdtempSync(join(tmpdir(), "tecscde-copy bat-"));
    temporary.push(root);
    const recorder = join(root, "recorder.mjs");
    const output = join(root, "received.json");
    const script = join(root, "tecsgen entry.bat");
    writeFileSync(recorder, "import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));");
    writeFileSync(script, `@echo off\r\n"${process.execPath}" "${recorder}" "${output}" %*\r\n`);
    const args = ["", "two words", 'gcc -I "C:\\A&B"', 'abc" &echo MUST_NOT_EXECUTE', "%PATH%", "!bang!", "日本語", "trailing\\"];
    const copied = formatTecsgenCommand({ executable: script, args: [], source: "settings" }, args, shell, root);
    exec(copied, shell, tmpdir());
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);
    expect(() => formatTecsgenCommand({ executable: script, args: [], source: "settings" }, ["line1\nline2"], shell)).toThrow(/改行/);
  }, 20_000);
});

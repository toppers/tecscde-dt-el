// 09D: batch and PowerShell entry points need explicit hosts on Windows.
// The returned argv is an execution plan, never a shell:true command string.
import { win32 } from "node:path";
import { statSync } from "node:fs";
import type { ResolvedTecsgenCommand } from "../shared/ipc-types.js";

export interface TecsgenInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

/** CRT argv quoting, linear even for long runs of backslashes. */
export function quoteWindowsArgument(value: string): string {
  let result = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") { slashes++; continue; }
    result += "\\".repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }
  return result + "\\".repeat(slashes * 2) + '"';
}

// The first cmd parse enters the batch; its %* forwarding performs a second
// parse before the native tecsgen host. Protect metacharacters at both levels.
const cmdMetaCharacters = /([()\][%!^"\x60<>&|;, *?])/g;
const escapeCmd = (value: string): string => value.replace(cmdMetaCharacters, "^$1");
const psLiteral = (value: string): string => "'" + value.replace(/'/g, "''") + "'";

/** Prefer PowerShell 7's UTF-8 script loading and native argument forwarding. */
export function resolvePowerShellScriptHost(
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = (path) => { try { return statSync(path).isFile(); } catch { return false; } },
): string {
  const path = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const candidates = path.split(";").filter(Boolean).map((dir) => win32.join(dir.replace(/^"|"$/g, ""), "pwsh.exe"));
  const programFiles = environment.ProgramFiles ?? environment.PROGRAMFILES;
  if (programFiles) candidates.push(win32.join(programFiles, "PowerShell", "7", "pwsh.exe"));
  return candidates.find(exists) ?? win32.join(environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function batchArgument(value: string): string {
  // Ordinary flags must remain ordinary batch parameters: quoting them twice
  // leaves literal carets in %~1 and breaks typical --version branches.
  if (/^[A-Za-z0-9_./:\\=+\-]+$/.test(value)) return value;
  if (/\s/.test(value) && /\\$/.test(value)) {
    throw new Error("Windowsバッチには空白を含みバックスラッシュで終わる引数を正確に渡せません。");
  }
  const quoted = quoteWindowsArgument(value);
  // Embedded quotes need protection again when the batch forwards %* to its
  // native interpreter; ordinary quoted parameters need only the entry parse.
  return value.includes('"') ? escapeCmd(escapeCmd(quoted)) : escapeCmd(quoted);
}

export function createTecsgenInvocation(
  command: ResolvedTecsgenCommand,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): TecsgenInvocation {
  const values = [...command.args, ...args];
  if ([command.executable, ...values].some((value) => value.includes("\0"))) {
    throw new Error("tecsgenのパスや引数にはNUL文字を指定できません。");
  }
  if (platform !== "win32") return { executable: command.executable, args: values };
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  if (/\.ps1$/i.test(command.executable)) {
    const script = "$ErrorActionPreference='Stop'; $global:LASTEXITCODE=0; $tecsArgs=@(" +
      values.map(psLiteral).join(",") + "); try { & " + psLiteral(command.executable) +
      " @tecsArgs; $tecsSucceeded=$?; if ($global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }; " +
      "if (-not $tecsSucceeded) { exit 1 }; exit 0 } catch { " +
      "[Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
    const plan: TecsgenInvocation = {
      executable: resolvePowerShellScriptHost(),
      args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    };
    if ([plan.executable, ...plan.args].join(" ").length > 32700) throw new Error("PowerShell起動コマンドが長すぎます。");
    return plan;
  }
  if (/\.(?:bat|cmd)$/i.test(command.executable)) {
    if ([command.executable, ...values].some((value) => /[\r\n]/.test(value))) {
      throw new Error("Windowsバッチ経由のtecsgenには改行を含むパスや引数を渡せません。");
    }
    if (command.executable.includes('"')) throw new Error("Windowsバッチのパスに引用符は指定できません。");
    const invocation = [escapeCmd(win32.normalize(command.executable)),
      ...values.map(batchArgument)].join(" ");
    const plan: TecsgenInvocation = {
      executable: win32.join(systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/s", "/v:off", "/c", '"' + invocation + '"'],
      windowsVerbatimArguments: true,
    };
    if ([plan.executable, ...plan.args].join(" ").length > 8191) throw new Error("Windowsバッチ起動コマンドが長すぎます。");
    return plan;
  }
  return { executable: command.executable, args: values };
}

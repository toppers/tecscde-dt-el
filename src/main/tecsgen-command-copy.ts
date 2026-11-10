// Audit 62: copy formatting is separate from the real executable/argv contract.
import { win32 } from "node:path";
import { gzipSync } from "node:zlib";
import type { ResolvedTecsgenCommand, TecsgenCopyShell } from "../shared/ipc-types.js";
import { createTecsgenInvocation, quoteWindowsArgument } from "./tecsgen-invocation.js";

export type { TecsgenCopyShell } from "../shared/ipc-types.js";

/**
 * Both PowerShell native argument modes and cmd's %/! expansion are bypassed by
 * passing user data as base64 JSON to a fixed ProcessStartInfo program. That
 * program uses literal FileName/Arguments properties, never Invoke-Expression.
 */
export function formatTecsgenCommand(
  command: ResolvedTecsgenCommand,
  args: readonly string[],
  shell: TecsgenCopyShell,
  cwd?: string,
): string {
  if (shell !== "powershell7" && shell !== "powershell5" && shell !== "cmd") {
    throw new Error("コピー先シェルを選択してください。");
  }
  if (!command.executable || command.source === "invalid" || command.source === "missing") {
    throw new Error("有効なtecsgen起動コマンドがありません。");
  }
  if ([command.executable, ...command.args, ...args, cwd ?? ""].some((value) => value.includes("\0"))) {
    throw new Error("起動コマンドにNUL文字は使用できません。");
  }
  const invocation = createTecsgenInvocation(command, args);
  const argumentLine = invocation.windowsVerbatimArguments ? invocation.args.join(" ") : invocation.args.map(quoteWindowsArgument).join(" ");
  // Compression does not bypass the underlying Windows process command-line limit.
  if (invocation.executable.length + argumentLine.length + 3 > 32700) {
    throw new Error("起動コマンドがWindowsの長さ上限を超えます。引数を短くしてください。");
  }
  const payload = gzipSync(Buffer.from(JSON.stringify({
    executable: invocation.executable,
    arguments: argumentLine,
    cwd: cwd ?? null,
    // Only transport additions belong in clipboard data, never inherited env/secrets.
    environment: Object.fromEntries(Object.entries(invocation.env ?? {})
      .filter(([key]) => key.startsWith("TECSCDE_INVOKE_"))),
  }), "utf8")).toString("base64");
  const program = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    `$tecscdeCompressed=[IO.MemoryStream]::new([Convert]::FromBase64String('${payload}'))`,
    "$tecscdeGzip=[IO.Compression.GZipStream]::new($tecscdeCompressed,[IO.Compression.CompressionMode]::Decompress)",
    "$tecscdeReader=[IO.StreamReader]::new($tecscdeGzip,[Text.Encoding]::UTF8)",
    "try{$tecscdeData=$tecscdeReader.ReadToEnd()|ConvertFrom-Json}finally{$tecscdeReader.Dispose()}",
    "$tecscdeStart=New-Object Diagnostics.ProcessStartInfo",
    "$tecscdeStart.UseShellExecute=$false",
    "$tecscdeStart.FileName=$tecscdeData.executable",
    "$tecscdeStart.Arguments=$tecscdeData.arguments",
    "if($null -ne $tecscdeData.cwd){$tecscdeStart.WorkingDirectory=$tecscdeData.cwd}",
    "foreach($tecscdeProperty in $tecscdeData.environment.PSObject.Properties){$tecscdeStart.EnvironmentVariables[$tecscdeProperty.Name]=[string]$tecscdeProperty.Value}",
    "$tecscdeProcess=[Diagnostics.Process]::Start($tecscdeStart)",
    "$tecscdeProcess.WaitForExit()",
    "exit $tecscdeProcess.ExitCode",
  ].join(";");
  const encoded = Buffer.from(program, "utf16le").toString("base64");
  const host = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const copied = shell === "cmd"
    ? `"${host}" -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`
    : `& '${host.replace(/'/g, "''")}' -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  if (copied.length > (shell === "cmd" ? 8191 : 32700)) {
    throw new Error("コマンドがコピー先シェルの長さ上限を超えます。引数を短くしてください。");
  }
  return copied;
}

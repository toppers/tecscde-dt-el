// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type { TecsgenResult, CppResult } from "../shared/ipc-types.js";

const execFileAsync = promisify(execFile);

// __tool_info__("cpp") is a command line. Preserve quoted paths and options,
// including backslashes in Windows paths, when passing it to execFile.
function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const char of command) {
    if (char === quote) {
      quote = null;
    } else if (quote === null && (char === '"' || char === "'")) {
      quote = char;
      started = true;
    } else if (quote === null && /\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote !== null) throw new Error("Unclosed quote in C preprocessor command");
  if (started) args.push(current);
  return args;
}

export class TecsgenRunner {
  async run(args: readonly string[]): Promise<TecsgenResult> {
    try {
      const { stdout, stderr } = await execFileAsync("tecsgen", args, { timeout: 30_000 });
      return { stdout, stderr, exitCode: 0, executableFound: true };
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        // 実行ファイルが見つからない（第2章2.4節の新規制約、11.2節#3の未決事項）
        return { stdout: "", stderr: "", exitCode: null, executableFound: false };
      }
      const exitCode = typeof e.code === "number" ? e.code : 1;
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode, executableFound: true };
    }
  }

  async preprocess(headerPath: string, cppCommand?: string): Promise<CppResult> {
    const cmd = cppCommand?.trim() || "gcc -E -DTECSGEN";
    try {
      const [executable, ...baseArgs] = splitCommand(cmd);
      const { stdout, stderr } = await execFileAsync(executable!, [...baseArgs, headerPath], { timeout: 30_000 });
      return { stdout, stderr, exitCode: 0, executableFound: true };
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        return { stdout: "", stderr: "", exitCode: null, executableFound: false };
      }
      const exitCode = typeof e.code === "number" ? e.code : 1;
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode, executableFound: true };
    }
  }

  async version(): Promise<string | null> {
    const result = await this.run(["--version"]);
    return result.executableFound ? result.stdout.trim() : null;
  }
}

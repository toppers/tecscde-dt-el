// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { TecsgenResult, CppResult, GeneratedCdlResult } from "../shared/ipc-types.js";

const execFileAsync = promisify(execFile);

async function generatedCdlSources(root: string): Promise<GeneratedCdlResult["sources"]> {
  const sources: Array<{ fileName: string; content: string }> = [];
  const pending = [root];
  let totalBytes = 0;
  while (pending.length > 0) {
    const dir = pending.pop()!;
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cdl")) continue;
      const bytes = await fs.readFile(path);
      totalBytes += bytes.length;
      if (sources.length >= 10_000 || totalBytes > 100 * 1024 * 1024) {
        throw new Error("Plugin生成CDLの読込上限を超えました。");
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        try {
          content = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
        } catch {
          content = new TextDecoder("euc-jp", { fatal: true }).decode(bytes);
        }
      }
      sources.push({ fileName: relative(root, path).replace(/\\/g, "/"), content });
    }
  }
  return sources;
}

function withoutOutputOption(args: readonly string[]): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "-g" || arg === "--gen") {
      i += 1;
    } else if (!arg.startsWith("--gen=") && !(arg.startsWith("-g") && arg.length > 2)) {
      filtered.push(arg);
    }
  }
  return filtered;
}

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
  async run(args: readonly string[], cwd?: string): Promise<TecsgenResult> {
    try {
      const [executable, ...prefixArgs] = process.env.TECSGEN_COMMAND
        ? splitCommand(process.env.TECSGEN_COMMAND)
        : ["tecsgen"];
      if (!executable) throw new Error("TECSGEN_COMMAND is empty");
      const options = cwd
        ? { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, cwd }
        : { timeout: 30_000 };
      const { stdout, stderr } = await execFileAsync(executable, [...prefixArgs, ...args], options);
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

  /** 全Pluginを実行し、一時生成先のCDLだけを表示モデル向けに読み取る。 */
  async generatedTypes(args: readonly string[], editingFilePath: string, optionsFilePath?: string): Promise<GeneratedCdlResult> {
    const outputDir = await fs.mkdtemp(join(tmpdir(), "tecscde-plugin-types-"));
    try {
      const invocationArgs = optionsFilePath
        ? splitCommand((await fs.readFile(optionsFilePath, "utf8"))
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith("#"))
          .join(" "))
        : args;
      const result = await this.run(
        ["-g", outputDir, ...withoutOutputOption(invocationArgs)],
        dirname(optionsFilePath ?? editingFilePath),
      );
      return { result, sources: await generatedCdlSources(outputDir) };
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
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

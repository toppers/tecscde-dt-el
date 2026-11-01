// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { TecsgenResult, TecsgenVersionResult, TecsgenLaunchFailure, CppResult, GeneratedCdlResult } from "../shared/ipc-types.js";

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

/** `-k`/`--kcode`（CDLの文字コード指定）が書かれているか。`-k <code>`、`-k<code>`、`--kcode <code>`、`--kcode=<code>`の各形を見る。 */
function hasKcodeOption(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-k" || arg === "--kcode" || arg.startsWith("--kcode=") || (arg.startsWith("-k") && !arg.startsWith("--")));
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

/**
 * 第9章9.7節: `execFile`の失敗を、終了コードでは表せない起動失敗に分類する。
 * 数値の終了コードで終わったもの（tecsgenが走って失敗した）は起動失敗ではないので`undefined`。
 */
export function classifyLaunchFailure(err: unknown, command: string): TecsgenLaunchFailure | undefined {
  const e = err as ExecFileException & { code?: number | string | null };
  if (typeof e.code === "number") return undefined;
  const detail = typeof e.code === "string" ? e.code : (e.message ?? String(err));
  if (e.code === "ENOENT") return { kind: "not-found", command, detail };
  if (e.code === "EACCES" || e.code === "EPERM") return { kind: "permission", command, detail };
  if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { kind: "output-overflow", command, detail };
  if (e.killed) return { kind: "timeout", command, detail: e.signal ?? detail };
  return { kind: "launch-error", command, detail };
}

export class TecsgenRunner {
  /**
   * 「実行(Generate)」用。上限は`run()`の既定（30秒・既定の`maxBuffer`）のまま、`cwd`だけを指定できる
   * （外部仕様5.3節: `.tecsgen-opts`のあるディレクトリで起動し、相対パスの基点を変えない）。
   * `run(args, cwd)`は上限が緩い（120秒・16MiB）Plugin型の取り込み用なので、使い分ける。
   */
  async generate(args: readonly string[], cwd?: string): Promise<TecsgenResult> {
    return this.run(args, cwd, cwd ? { timeout: 30_000, cwd } : { timeout: 30_000 });
  }

  async run(
    args: readonly string[],
    cwd?: string,
    execOptions?: { readonly timeout: number; readonly cwd?: string },
  ): Promise<TecsgenResult> {
    let command = process.env.TECSGEN_COMMAND || "tecsgen";
    try {
      const [executable, ...prefixArgs] = process.env.TECSGEN_COMMAND
        ? splitCommand(process.env.TECSGEN_COMMAND)
        : ["tecsgen"];
      if (!executable) throw new Error("TECSGEN_COMMAND is empty");
      command = executable;
      const options = execOptions ?? (cwd
        ? { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, cwd }
        : { timeout: 30_000 });
      const { stdout, stderr } = await execFileAsync(executable, [...prefixArgs, ...args], options);
      return { stdout, stderr, exitCode: 0, executableFound: true };
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      const launchFailure = classifyLaunchFailure(err, command);
      if (launchFailure?.kind === "not-found") {
        // 実行ファイルが見つからない（第2章2.4節の新規制約、11.2節#3の未決事項）
        return { stdout: "", stderr: "", exitCode: null, executableFound: false, launchFailure };
      }
      if (launchFailure) {
        // 権限なし・タイムアウト・出力過多など（第9章9.7節）。終了コードは無い。
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: null, executableFound: true, launchFailure };
      }
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code as number, executableFound: true };
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
      // オプションファイルに`-k`が無いときは`-k utf8`を足す（第9章冒頭の注記）。tecsgenの`-k`の既定は`euc`で、
      // UTF-8のCDLをeucとして読むのを避ける。`-k`が書かれていれば、その値を尊重する。
      const kcodeArgs = optionsFilePath && !hasKcodeOption(invocationArgs) ? ["-k", "utf8"] : [];
      const result = await this.run(
        ["-g", outputDir, ...kcodeArgs, ...withoutOutputOption(invocationArgs)],
        dirname(optionsFilePath ?? editingFilePath),
      );
      return { result, sources: await generatedCdlSources(outputDir) };
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }

  /**
   * `includeDirs`はtecsgenの`-I`/import_pathに相当する探索ディレクトリ。これを渡さないと
   * `#include "kernel.h"`のようなプロジェクト内のヘッダを解決できず、プリプロセスが失敗する。
   */
  async preprocess(headerPath: string, cppCommand?: string, includeDirs: readonly string[] = []): Promise<CppResult> {
    const cmd = cppCommand?.trim() || "gcc -E -DTECSGEN";
    try {
      const [executable, ...baseArgs] = splitCommand(cmd);
      const includeArgs = [...new Set(includeDirs.map((dir) => `-I${resolve(dir)}`))];
      const { stdout, stderr } = await execFileAsync(executable!, [...baseArgs, ...includeArgs, headerPath], {
        timeout: 30_000,
      });
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

  /**
   * 第9C章9C.2節: `tecsgen --version`で版を読む。tecsgenは版を標準エラー出力へ出すため、
   * 標準出力が空なら標準エラー出力から読む。
   */
  async version(): Promise<TecsgenVersionResult> {
    // 外部仕様3.8: バージョン情報ダイアログに、使われた起動コマンドも出す。
    const command = process.env.TECSGEN_COMMAND || "tecsgen";
    const result = await this.run(["--version"]);
    if (result.launchFailure?.kind === "not-found") return { kind: "not-found", command };
    if (result.launchFailure) {
      const { kind, detail } = result.launchFailure;
      return { kind: "failed", detail: `${kind}: ${detail}`, command };
    }
    if (result.exitCode !== 0) return { kind: "failed", detail: `終了コード ${result.exitCode}`, command };
    return { kind: "ok", text: result.stdout.trim() || result.stderr.trim(), command };
  }
}

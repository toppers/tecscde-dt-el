// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  TecsgenResult,
  TecsgenVersionResult,
  TecsgenLaunchFailure,
  CppResult,
  CppOriginReason,
  GeneratedCdlResult,
  ResolvedTecsgenCommand,
} from "../shared/ipc-types.js";
import { environmentCommand, snapshotTecsgenEnvironment, splitCommand } from "./tecsgen-path-resolver.js";
import { createTecsgenInvocation } from "./tecsgen-invocation.js";
import { findOnPath, type ResolvedCppCommand } from "./tool-settings.js";

const execFileAsync = promisify(execFile);

/**
 * Windows の MSYS2 の gcc.exe は、子プロセス cc1.exe を PATH 上の最初の DLL で起動する。PATH 上で
 * gcc のディレクトリより前に、別ツールが同梱する古い libwinpthread などの DLL（例: Meld）があると、
 * 標準エラー出力なしで終了コード 1 になる。コンパイラ自身のディレクトリを、子プロセスの PATH の
 * 先頭へ足して避ける。コンパイラのフルパスが分からないとき、Windows 以外では何もしない（`undefined`）。
 * `process.env` は書き換えない。
 */
function envWithCompilerDirFirst(
  compilerPath: string,
  platform: NodeJS.Platform = process.platform,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv | undefined {
  if (platform !== "win32" || !isAbsolute(compilerPath)) return undefined;
  const key = Object.keys(base).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const current = base[key] ?? "";
  const dir = dirname(compilerPath);
  return { ...base, [key]: current ? `${dir}${delimiter}${current}` : dir };
}

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

/**
 * `-S`/`--system-dir`（システム定義ディレクトリ）をtecsgen向けの`-I`に置き換える（記述順を保つ）。
 * tecsgen本体は`-S`を持たない（アプリ独自。外部仕様5.3・8.x）。そのまま渡すと、`-S`をCDLのファイル名と
 * 取り違えて失敗し、Plugin生成型が読み込まれない。`-S<dir>`・`--system-dir=<dir>`の形も扱う。
 */
function systemDirsAsImportPaths(args: readonly string[]): string[] {
  const converted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "-S" || arg === "--system-dir") {
      const value = args[i + 1];
      if (value !== undefined) converted.push("-I", value);
      i += 1;
    } else if (arg.startsWith("--system-dir=")) {
      converted.push("-I", arg.slice("--system-dir=".length));
    } else if (arg.startsWith("-S") && !arg.startsWith("--")) {
      converted.push("-I", arg.slice(2));
    } else {
      converted.push(arg);
    }
  }
  return converted;
}

/** `-k`/`--kcode`（CDLの文字コード指定）が書かれているか。`-k <code>`、`-k<code>`、`--kcode <code>`、`--kcode=<code>`の各形を見る。 */
function hasKcodeOption(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-k" || arg === "--kcode" || arg.startsWith("--kcode=") || (arg.startsWith("-k") && !arg.startsWith("--")));
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

/**
 * 標準エラー出力を最大 maxLen 文字に要約する。
 * 空行を除き、改行を空白に置換して切り詰める。
 */
export function summarizeStderr(stderr: string, maxLen = 200): string {
  if (!stderr) return "";
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";
  const joined = lines.join(" ");
  return joined.length <= maxLen ? joined : joined.slice(0, maxLen);
}

export class TecsgenRunner {
  private readonly environment = snapshotTecsgenEnvironment(process.env);

  constructor(private readonly resolveCommandProvider?: () => Promise<ResolvedTecsgenCommand>) {}

  private async command(): Promise<ResolvedTecsgenCommand> {
    const resolved = this.resolveCommandProvider
      ? await this.resolveCommandProvider()
      : environmentCommand(this.environment) ?? { executable: "tecsgen", args: [], source: "path" as const };
    return { ...resolved, args: [...resolved.args] };
  }
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
    return this.runCommand(this.command(), args, cwd, execOptions);
  }

  private async runCommand(
    resolved: Promise<ResolvedTecsgenCommand>,
    args: readonly string[],
    cwd?: string,
    execOptions?: { readonly timeout: number; readonly cwd?: string },
  ): Promise<TecsgenResult> {
    return (await this.runCommandWithText(resolved, args, cwd, execOptions)).result;
  }

  /** `result`に加え、実際に使った起動コマンド（引数込み）を返す。バージョン情報ダイアログ用（外部仕様3.8）。 */
  private async runCommandWithText(
    resolved: Promise<ResolvedTecsgenCommand>,
    args: readonly string[],
    cwd?: string,
    execOptions?: { readonly timeout: number; readonly cwd?: string },
  ): Promise<{ readonly result: TecsgenResult; readonly command: string }> {
    let commandText = "tecsgen";
    let command = this.environment.TECSGEN_COMMAND ?? "tecsgen";
    let settingsRevision: number | undefined;
    const done = (result: TecsgenResult): { readonly result: TecsgenResult; readonly command: string } => ({
      result: settingsRevision === undefined ? result : { ...result, settingsRevision },
      command: commandText,
    });
    try {
      const snapshot = await resolved;
      settingsRevision = snapshot.revision;
      if (snapshot.source === "missing") throw Object.assign(new Error("tecsgen not found"), { code: "ENOENT" });
      if (!snapshot.executable) throw new Error("TECSGEN_COMMAND or tecsgen path is empty or invalid");
      command = snapshot.executable;
      commandText = [snapshot.executable, ...snapshot.args].join(" ");
      // A script host can exist after its selected entry point has disappeared.
      // Preserve the normal not-found result instead of treating host exit 1 as
      // an unknown version, and do not resolve unqualified environment commands.
      if (process.platform === "win32" && isAbsolute(snapshot.executable) && /\.(?:bat|cmd|ps1)$/i.test(snapshot.executable)) {
        await fs.access(snapshot.executable);
      }
      const options = execOptions ?? (cwd
        ? { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, cwd }
        : { timeout: 30_000 });
      const invocation = createTecsgenInvocation(snapshot, args);
      const { stdout, stderr } = await execFileAsync(invocation.executable, [...invocation.args], {
        ...options, shell: false,
        ...(invocation.executable !== snapshot.executable ? { windowsHide: true } : {}),
        ...(invocation.windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}),
        ...(invocation.env ? { env: { ...process.env, ...invocation.env } } : {}),
      });
      return done({ stdout, stderr, exitCode: 0, executableFound: true });
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      const launchFailure = classifyLaunchFailure(err, command);
      if (launchFailure?.kind === "not-found") {
        // 実行ファイルが見つからない（第2章2.4節の新規制約、11.2節#3の未決事項）
        return done({ stdout: "", stderr: "", exitCode: null, executableFound: false, launchFailure });
      }
      if (launchFailure) {
        // 権限なし・タイムアウト・出力過多など（第9章9.7節）。終了コードは無い。
        return done({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: null, executableFound: true, launchFailure });
      }
      return done({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code as number, executableFound: true });
    }
  }

  /** 全Pluginを実行し、一時生成先のCDLだけを表示モデル向けに読み取る。 */
  async generatedTypes(args: readonly string[], editingFilePath: string, optionsFilePath?: string): Promise<GeneratedCdlResult> {
    // Resolve once at operation entry, before reading options or creating output.
    const command = await this.command().catch((): ResolvedTecsgenCommand => ({ executable: "", args: [], source: "invalid" }));
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
      const result = await this.runCommand(
        Promise.resolve(command),
        ["-g", outputDir, ...kcodeArgs, ...withoutOutputOption(systemDirsAsImportPaths(invocationArgs))],
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
  async preprocess(
    headerPath: string,
    cppCommand?: string | ResolvedCppCommand,
    includeDirs: readonly string[] = [],
  ): Promise<CppResult> {
    let cmd: string;
    let executable: string;
    let fullPath: string;
    let originReason: CppOriginReason;

    if (typeof cppCommand === "object" && cppCommand !== null) {
      cmd = cppCommand.command;
      executable = cppCommand.executable;
      fullPath = cppCommand.fullPath;
      originReason = cppCommand.originReason;
    } else if (typeof cppCommand === "string" && cppCommand.trim().length > 0) {
      cmd = cppCommand.trim();
      originReason = "ユーザ直接指定";
      try {
        const parts = splitCommand(cmd);
        executable = parts[0] ?? "";
      } catch {
        executable = cmd.split(/\s+/)[0] ?? "";
      }
      fullPath = isAbsolute(executable) ? executable : (findOnPath(executable) ?? executable);
    } else {
      cmd = "gcc -E -DTECSGEN";
      originReason = "フォールバック";
      executable = "gcc";
      const fallbackFound = findOnPath("gcc");
      fullPath = fallbackFound ?? "未検出 (PATH上)";
    }

    try {
      const parts = splitCommand(cmd);
      const exe = parts[0];
      const baseArgs = parts.slice(1);
      if (!exe) {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          executableFound: false,
          command: cmd,
          originReason,
          fullPath: fullPath || "未検出 (PATH上)",
          failureKind: "not-found",
          failureDetail: `'${executable || cmd}' が見つかりません`,
        };
      }
      executable = exe;

      const includeArgs = [...new Set(includeDirs.map((dir) => `-I${resolve(dir)}`))];
      const env = envWithCompilerDirFirst(isAbsolute(executable) ? executable : fullPath);
      const { stdout, stderr } = await execFileAsync(executable, [...baseArgs, ...includeArgs, headerPath], {
        timeout: 30_000,
        ...(env ? { env } : {}),
      });
      return {
        stdout,
        stderr,
        exitCode: 0,
        executableFound: true,
        command: cmd,
        originReason,
        fullPath,
      };
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          executableFound: false,
          command: cmd,
          originReason,
          fullPath: fullPath || "未検出 (PATH上)",
          failureKind: "not-found",
          failureDetail: `'${executable}' が見つかりません`,
        };
      }

      const isTimeout =
        e.killed === true ||
        e.signal === "SIGTERM" ||
        e.code === "ETIMEDOUT" ||
        (typeof e.message === "string" && e.message.toLowerCase().includes("timed out"));

      if (isTimeout) {
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? "",
          exitCode: typeof e.code === "number" ? e.code : null,
          executableFound: true,
          command: cmd,
          originReason,
          fullPath,
          failureKind: "timeout",
          failureDetail: "30秒以内に完了しなかったためタイムアウトしました",
        };
      }

      const exitCode = typeof e.code === "number" ? e.code : 1;
      const rawStderr = e.stderr ?? "";
      const stderrExcerpt = summarizeStderr(rawStderr);
      const failureDetail = stderrExcerpt ? `終了コード ${exitCode}: ${stderrExcerpt}` : `終了コード ${exitCode}`;

      return {
        stdout: e.stdout ?? "",
        stderr: rawStderr,
        exitCode,
        executableFound: true,
        command: cmd,
        originReason,
        fullPath,
        failureKind: "failed",
        failureDetail,
      };
    }
  }

  /**
   * 第9C章9C.2節: `tecsgen --version`で版を読む。tecsgenは版を標準エラー出力へ出すため、
   * 標準出力が空なら標準エラー出力から読む。
   */
  async version(): Promise<TecsgenVersionResult> {
    // 外部仕様3.8: バージョン情報ダイアログに、使われた起動コマンドも出す。
    const { result, command } = await this.runCommandWithText(this.command(), ["--version"]);
    if (result.launchFailure?.kind === "not-found") return { kind: "not-found", command };
    if (result.launchFailure) {
      const { kind, detail } = result.launchFailure;
      return { kind: "failed", detail: `${kind}: ${detail}`, command };
    }
    if (result.exitCode !== 0) {
      const reason = (result.stderr.trim() || result.stdout.trim()).slice(0, 1000);
      return { kind: "failed", detail: `終了コード ${result.exitCode}${reason ? `: ${reason}` : ""}`, command };
    }
    return { kind: "ok", text: result.stdout.trim() || result.stderr.trim(), command };
  }
}

// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { TecsgenResult, TecsgenVersionResult, TecsgenLaunchFailure, CppResult, GeneratedCdlResult, ResolvedTecsgenCommand } from "../shared/ipc-types.js";
import { environmentCommand, snapshotTecsgenEnvironment, splitCommand } from "./tecsgen-path-resolver.js";
import { createTecsgenInvocation } from "./tecsgen-invocation.js";

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
    let command = this.environment.TECSGEN_COMMAND ?? "tecsgen";
    let settingsRevision: number | undefined;
    const withRevision = (result: TecsgenResult): TecsgenResult =>
      settingsRevision === undefined ? result : { ...result, settingsRevision };
    try {
      const snapshot = await resolved;
      settingsRevision = snapshot.revision;
      if (snapshot.source === "missing") throw Object.assign(new Error("tecsgen not found"), { code: "ENOENT" });
      if (!snapshot.executable) throw new Error("TECSGEN_COMMAND or tecsgen path is empty or invalid");
      command = snapshot.executable;
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
      return withRevision({ stdout, stderr, exitCode: 0, executableFound: true });
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      const launchFailure = classifyLaunchFailure(err, command);
      if (launchFailure?.kind === "not-found") {
        // 実行ファイルが見つからない（第2章2.4節の新規制約、11.2節#3の未決事項）
        return withRevision({ stdout: "", stderr: "", exitCode: null, executableFound: false, launchFailure });
      }
      if (launchFailure) {
        // 権限なし・タイムアウト・出力過多など（第9章9.7節）。終了コードは無い。
        return withRevision({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: null, executableFound: true, launchFailure });
      }
      return withRevision({ stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code as number, executableFound: true });
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
    const result = await this.run(["--version"]);
    if (result.launchFailure?.kind === "not-found") return { kind: "not-found" };
    if (result.launchFailure) {
      const { kind, detail } = result.launchFailure;
      return { kind: "failed", detail: `${kind}: ${detail}` };
    }
    if (result.exitCode !== 0) {
      const reason = (result.stderr.trim() || result.stdout.trim()).slice(0, 1000);
      return { kind: "failed", detail: `終了コード ${result.exitCode}${reason ? `: ${reason}` : ""}` };
    }
    return { kind: "ok", text: result.stdout.trim() || result.stderr.trim() };
  }
}

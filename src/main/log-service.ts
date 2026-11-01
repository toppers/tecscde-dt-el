// 診断パネルに表示した内容をテキストファイルへ追記するログ出力（main）。
// ファイル名は起動ごとに `tecscde-log-YYYYMMDD-HHMMSS.txt`。置き場所は設定ファイルと同じ
// フォルダの `logs/`（外部仕様9.5.2の規定2。呼び出し側が `logsDirectory()` を渡す）。
// 書けないときはアプリを止めず、最初の失敗だけを呼び出し元へ知らせる（規定13）。

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { LogAppendResult } from "../shared/ipc-types.js";

/** 起動時に残すログファイルの数（外部仕様9.5.2の規定12）。 */
export const LOG_KEEP_COUNT = 30;

const LOG_FILE_PATTERN = /^tecscde-log-\d{8}-\d{6}\.txt$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function logFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `tecscde-log-${date}-${time}.txt`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Node のシステムエラーの message は、すでに「ENOTDIR: …」のようにコードで始まる。
    return code && !error.message.startsWith(code) ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/**
 * `dir` の中の `tecscde-log-YYYYMMDD-HHMMSS.txt` のうち、ファイル名の新しい順に
 * `LOG_KEEP_COUNT` 件を残して、古いものを消す。他のファイルやサブフォルダには触れない。
 * 削除の失敗やフォルダが無い場合は無視する（規定12）。
 */
export async function pruneOldLogs(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const names = entries
    .filter((e) => e.isFile() && LOG_FILE_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
  const stale = names.slice(0, Math.max(0, names.length - LOG_KEEP_COUNT));
  for (const name of stale) {
    try {
      await fs.rm(join(dir, name));
    } catch {
      // 削除の失敗は無視する
    }
  }
}

export class LogService {
  private readonly fileName: string;
  private readonly startedAt: Date;
  private filePath: string | null = null;
  private failureReported = false;
  private queue: Promise<LogAppendResult> = Promise.resolve({});

  /**
   * @param dir ログを置くフォルダ（無ければ作る）。
   * @param appVersion 先頭行に書くアプリケーションの版（外部仕様9.5.2の規定5。mainは `app.getVersion()` を渡す）。
   */
  constructor(
    private readonly dir: string,
    private readonly appVersion: string,
    now: () => Date = () => new Date(),
  ) {
    this.startedAt = now();
    this.fileName = logFileName(this.startedAt);
  }

  /** 書き込み先のパス。まだ一度も書き込めていなければ null。 */
  get path(): string | null {
    return this.filePath;
  }

  /**
   * 行を順序どおりに追記する。失敗してもアプリの動作は止めない。
   * 結果は、直前まで書けていたのに初めて失敗したときだけ `newFailure`（理由）を持つ。
   * 書けるようになれば、次に失敗したときは再び知らせる。
   */
  append(lines: readonly string[]): Promise<LogAppendResult> {
    if (lines.length === 0) return this.queue;
    const text = `${lines.join("\n")}\n`;
    this.queue = this.queue.then(() => this.write(text));
    return this.queue;
  }

  private async write(text: string): Promise<LogAppendResult> {
    try {
      if (this.filePath) {
        await fs.appendFile(this.filePath, text, "utf8");
      } else {
        const header = `# TECSCDE 診断ログ（起動: ${this.startedAt.toISOString()}、版: ${this.appVersion}）\n`;
        await fs.mkdir(this.dir, { recursive: true });
        const candidate = join(this.dir, this.fileName);
        await fs.writeFile(candidate, header + text, "utf8");
        this.filePath = candidate;
      }
      this.failureReported = false;
      return {};
    } catch (error) {
      console.error(`ログファイルへ書けませんでした: ${this.filePath ?? this.dir}`, error);
      if (this.failureReported) return {};
      this.failureReported = true;
      return { newFailure: describeError(error) };
    }
  }
}

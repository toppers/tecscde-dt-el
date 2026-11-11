// 診断パネルに表示した内容をテキストファイルへ追記するログ出力（main）。
// 外部仕様9.5節 / 監査#64〜#68: 設定ディレクトリ配下の固定logs/へ出力し、最新30個に保つ。
// 失敗時は一度だけ画面に警告通知し、任意ディレクトリへフォールバックしない。

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { LogAppendResult } from "../shared/ipc-types";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export const LOG_FILE_REGEX = /^tecscde-log-\d{8}-\d{6}\.txt$/;

export function logFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `tecscde-log-${date}-${time}.txt`;
}

/**
 * 監査#65: 固定logsディレクトリ内の古いログを削除し、最新maxKeep個（既定30個）に制限する。
 * サブディレクトリや対象外ファイルを再帰削除しない。エラー発生時も処理を継続する。
 */
export async function pruneOldLogs(logsDir: string, maxKeep = 30): Promise<void> {
  try {
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    const logFiles: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && LOG_FILE_REGEX.test(entry.name)) {
        logFiles.push(entry.name);
      }
    }
    logFiles.sort(); // 名前順＝日時順
    if (logFiles.length > maxKeep) {
      const toDelete = logFiles.slice(0, logFiles.length - maxKeep);
      for (const file of toDelete) {
        try {
          await fs.unlink(join(logsDir, file));
        } catch {
          // 個別削除失敗は処理継続
        }
      }
    }
  } catch {
    // ディレクトリ不在や列挙失敗は処理継続
  }
}

export class LogService {
  private readonly fileName: string;
  private readonly startedAt: Date;
  private filePath: string | null = null;
  private failed = false;
  private queue: Promise<LogAppendResult> = Promise.resolve({ success: true, newFailure: false });
  private pendingLines: string[] = [];

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
   * 行を順序どおりに追記する。
   * 監査#66: 初回失敗時のみ newFailure: true を返し、rendererがW-LOG-WRITE-FAILEDを画面へ一度だけ出す。
   * 監査#67: 区切り行のみで実際の診断や版情報がない場合はファイルを作成しない。
   */
  append(lines: readonly string[]): Promise<LogAppendResult> {
    if (lines.length === 0) return Promise.resolve({ success: true, newFailure: false });

    // 実記録（区切り行以外）があるか、または既にファイル作成済みか
    if (!this.filePath) {
      const hasActualRecord = lines.some((line) => !line.startsWith("--- ") || !line.endsWith(" ---"));
      if (!hasActualRecord) {
        this.pendingLines.push(...lines);
        return Promise.resolve({ success: true, newFailure: false });
      }
    }

    const allLines = [...this.pendingLines, ...lines];
    this.pendingLines = [];
    const text = `${allLines.join("\n")}\n`;
    this.queue = this.queue.then(async () => {
      try {
        await this.write(text);
        return { success: true, newFailure: false };
      } catch (error) {
        const newFailure = !this.failed;
        this.failed = true;
        console.error("ログファイルへの書き込みに失敗しました:", error);
        return { success: false, newFailure, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return this.queue;
  }

  private async write(text: string): Promise<void> {
    if (this.filePath) {
      await fs.appendFile(this.filePath, text, "utf8");
      return;
    }
    const header = `# TECSCDE 診断ログ（起動: ${this.startedAt.toISOString()}、版: ${this.appVersion}）\n`;
    await fs.mkdir(this.dir, { recursive: true });
    const candidate = join(this.dir, this.fileName);
    await fs.writeFile(candidate, header + text, "utf8");
    this.filePath = candidate;
  }
}

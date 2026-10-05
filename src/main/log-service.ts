// 診断パネルに表示した内容をテキストファイルへ追記するログ出力（main）。
// ファイル名は起動ごとに `tecscde-log-YYYYMMDD-HHMMSS.txt`。起動時のカレントディレクトリを
// 第一候補とし、書き込めない場合（インストール先が読み取り専用など）は次の候補へ回す。

import { promises as fs } from "node:fs";
import { join } from "node:path";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function logFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `tecscde-log-${date}-${time}.txt`;
}

export class LogService {
  private readonly fileName: string;
  private readonly startedAt: Date;
  private filePath: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dirs: readonly string[],
    now: () => Date = () => new Date(),
  ) {
    this.startedAt = now();
    this.fileName = logFileName(this.startedAt);
  }

  /** 書き込み先のパス。まだ一度も書き込めていなければ null。 */
  get path(): string | null {
    return this.filePath;
  }

  /** 行を順序どおりに追記する。失敗してもアプリの動作は止めず、標準エラーへ報告する。 */
  append(lines: readonly string[]): Promise<void> {
    if (lines.length === 0) return this.queue;
    const text = `${lines.join("\n")}\n`;
    this.queue = this.queue.then(() => this.write(text));
    return this.queue;
  }

  private async write(text: string): Promise<void> {
    if (this.filePath) {
      try {
        await fs.appendFile(this.filePath, text, "utf8");
        return;
      } catch (error) {
        console.error(`ログファイルへ追記できませんでした: ${this.filePath}`, error);
        return;
      }
    }
    const header = `# TECSCDE 診断ログ（起動: ${this.startedAt.toISOString()}）\n`;
    let lastError: unknown;
    for (const dir of this.dirs) {
      const candidate = join(dir, this.fileName);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(candidate, header + text, "utf8");
        this.filePath = candidate;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    console.error("ログファイルを作成できませんでした:", this.dirs, lastError);
  }
}

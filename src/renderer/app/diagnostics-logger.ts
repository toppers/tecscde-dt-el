// 診断パネルに表示される内容（`AppStore.getReport()`）を、ログファイルへも書き出す。
// ストアの変更のたびに呼ばれるため、直前のレポートとの差分（新しく現れた診断）だけを送る。
// 編集対象のファイルが変わったときは区切り行を入れ、そのファイルの診断を最初から記録する。

import { formatDiagnostic } from "../diagnostics/format";
import type { AppStore } from "./store";

export class DiagnosticsLogger {
  private previous: ReadonlySet<string> = new Set();
  private currentFile: string | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly write: (lines: readonly string[]) => Promise<void>,
  ) {}

  sync(): void {
    const lines = this.store.getReport().items.map(formatDiagnostic);
    const out: string[] = [];

    const filePath = this.store.filePath;
    if (filePath !== this.currentFile) {
      this.currentFile = filePath;
      this.previous = new Set();
      if (filePath) out.push(`--- ${filePath} ---`);
    }

    for (const line of lines) {
      if (!this.previous.has(line)) out.push(line);
    }
    this.previous = new Set(lines);

    if (out.length > 0) {
      this.write(out).catch((error: unknown) => console.error("ログ出力に失敗しました:", error));
    }
  }
}

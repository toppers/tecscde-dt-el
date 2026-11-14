// 診断パネルに表示される内容（`AppStore.getReport()`）を、ログファイルへも書き出す。
// ストアの変更のたびに呼ばれるため、直前のレポートとの差分（新しく現れた診断）だけを送る。
// 編集対象のファイルが変わったときは区切り行を保留し、実際の診断が記録されるときに初めて出力する（監査#67）。
// W-LOG-WRITE-FAILED 自身はログ追記から除外して再帰を防止する（監査#66）。

import { formatDiagnostic } from "../diagnostics/format";
import { LOG_WRITE_FAILED_CODE } from "./log-warning";
import type { AppStore } from "./store";

export class DiagnosticsLogger {
  private previous: ReadonlySet<string> = new Set();
  private currentFile: string | null = null;
  private pendingDelimiter: string | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly write: (lines: readonly string[]) => Promise<unknown>,
  ) {}

  sync(): void {
    // ログを書けない警告は、ログへ書かない（書けないため。外部仕様9.5.2の規定13）。
    const lines = this.store
      .getReport()
      .items.filter((d) => d.code !== LOG_WRITE_FAILED_CODE)
      .map(formatDiagnostic);
    const out: string[] = [];

    const filePath = this.store.filePath;
    if (filePath !== this.currentFile) {
      this.currentFile = filePath;
      this.previous = new Set();
      this.pendingDelimiter = filePath ? `--- ${filePath} ---` : null;
    }

    const newLines: string[] = [];
    for (const line of lines) {
      if (!this.previous.has(line)) newLines.push(line);
    }
    this.previous = new Set(lines);

    if (newLines.length > 0) {
      const out: string[] = [];
      if (this.pendingDelimiter !== null) {
        out.push(this.pendingDelimiter);
        this.pendingDelimiter = null;
      }
      out.push(...newLines);
      this.write(out).catch((error: unknown) => console.error("ログ出力に失敗しました:", error));
    }
  }
}

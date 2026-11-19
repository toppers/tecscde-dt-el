// 診断パネルに表示される内容（`AppStore.getReport()`）を、ログファイルへも書き出す。
// ストアの変更のたびに呼ばれるため、直前のレポートとの差分（新しく現れた診断）だけを送る。
// 編集対象のファイルが変わったときは区切り行を保留し、実際の診断が記録されるときに初めて出力する（監査#67）。
// W-LOG-WRITE-FAILED 自身はログ追記から除外して再帰を防止する（監査#66）。

import { formatDiagnostic } from "../diagnostics/format";
import type { LogKind } from "../../shared/ipc-types.js";
import { LOG_WRITE_FAILED_CODE } from "./log-warning";
import type { AppStore } from "./store";

export class DiagnosticsLogger {
  private previous: ReadonlySet<string> = new Set();
  private currentFile: string | null = null;
  private pendingDelimiters: Record<"diagnosis" | "error", string | null> = { diagnosis: null, error: null };

  constructor(
    private readonly store: AppStore,
    private readonly write: (lines: readonly string[], kind?: LogKind) => Promise<unknown>,
  ) {}

  sync(): void {
    // ログを書けない警告は、ログへ書かない（書けないため。外部仕様9.5.2の規定13）。
    const items = this.store
      .getReport()
      .items.filter((d) => d.code !== LOG_WRITE_FAILED_CODE);

    const filePath = this.store.filePath;
    if (filePath !== this.currentFile) {
      this.currentFile = filePath;
      this.previous = new Set();
      this.pendingDelimiters = {
        diagnosis: filePath ? `--- ${filePath} ---` : null,
        error: filePath ? `--- ${filePath} ---` : null,
      };
    }

    const newLines: Record<"diagnosis" | "error", string[]> = { diagnosis: [], error: [] };
    const lines = items.map((d) => ({ line: formatDiagnostic(d), kind: d.code.startsWith("E-") ? "error" as const : "diagnosis" as const }));
    for (const { line, kind } of lines) {
      if (!this.previous.has(line)) newLines[kind].push(line);
    }
    this.previous = new Set(lines.map(({ line }) => line));

    for (const kind of ["diagnosis", "error"] as const) {
      if (newLines[kind].length === 0) continue;
      const out: string[] = [];
      if (this.pendingDelimiters[kind] !== null) {
        out.push(this.pendingDelimiters[kind]!);
        this.pendingDelimiters[kind] = null;
      }
      out.push(...newLines[kind]);
      this.write(out, kind).catch((error: unknown) => console.error("ログ出力に失敗しました:", error));
    }
  }
}

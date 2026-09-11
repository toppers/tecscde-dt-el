// [[TECSCDE-DT-EL内部仕様]] 第8章8.1〜8.2節 — 診断の集約。
//
// 第8章は [[TECSCDE-TS内部仕様]] 第8章と「完全に同一、変更なし」。診断の集約方針
// （複数の発生源からの診断を1件のレポートにまとめる、外部仕様8.3.2）をクラスで表現する。
//
// 発生源はモジュールB（`CdlDocumentLoader` のパース診断）、モジュールH 自身の
// `checkIntegrity`（integrity.ts）、モジュールI（tecsgen 実行結果、9.4節の
// `TecsgenResultParser`）。`DiagnosticsCollector` は呼び出し元が renderer の
// 純粋計算結果か IPC の戻り値かを区別しない（DT-EL内部仕様 第8章）。
//
// このモジュールは renderer プロセスで完結し、`electron` へは触れない。

import type { Diagnostic } from "./types";

/** error を warning より前に並べるための順序値。 */
const SEVERITY_ORDER: Readonly<Record<Diagnostic["severity"], number>> = { error: 0, warning: 1 };

/**
 * 複数の発生源から随時 `report()` された診断を保持する。
 *
 * `diagnostics` 配列は可変で保持する —— 第5章5.3節の `GestureController.state` と同様、
 * 外部に公開されず、モデル（第3章）や履歴（第4章）に反映されない診断パイプライン
 * 内部の一時状態であるため、`CLAUDE.md` のイミュータブル方針の対象外（8.2節の note）。
 * `toReport()` が返す `DiagnosticReport` 自体は不変な値クラスであり、モジュールG は
 * この不変スナップショットのみを参照する。
 */
export class DiagnosticsCollector {
  private readonly diagnostics: Diagnostic[] = [];

  /** 発生源ごとに随時1件追加する。 */
  report(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  /** まとめて追加する（`loadSources` の戻り診断・`checkIntegrity` の結果など）。 */
  reportAll(diagnostics: readonly Diagnostic[]): void {
    for (const d of diagnostics) this.diagnostics.push(d);
  }

  /** 新規読込・チェック再実行のたびにリセットする。 */
  clear(): void {
    this.diagnostics.length = 0;
  }

  get size(): number {
    return this.diagnostics.length;
  }

  /** 現在の集約結果を不変スナップショットとして取り出す。 */
  toReport(): DiagnosticReport {
    return new DiagnosticReport(this.diagnostics);
  }
}

/**
 * 集約済み診断の不変スナップショット。モジュールG（UIシェル）が参照する唯一の面。
 * `items` は severity 昇順（error → warning）で安定ソートされる（8.4節の一覧表示前提）。
 */
export class DiagnosticReport {
  readonly items: readonly Diagnostic[];

  constructor(items: readonly Diagnostic[]) {
    this.items = [...items]
      .map((d, i) => [d, i] as const)
      .sort(([a, ai], [b, bi]) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || ai - bi)
      .map(([d]) => d);
  }

  static empty(): DiagnosticReport {
    return new DiagnosticReport([]);
  }

  get errorCount(): number {
    return this.items.reduce((n, d) => n + (d.severity === "error" ? 1 : 0), 0);
  }

  get warningCount(): number {
    return this.items.reduce((n, d) => n + (d.severity === "warning" ? 1 : 0), 0);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}

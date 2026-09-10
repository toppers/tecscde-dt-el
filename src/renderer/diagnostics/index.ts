// [[TECSCDE-DT-EL内部仕様]] 第8章 — 整合性チェック／診断（モジュールH）の公開面。
// 第2章2.3節のとおり renderer プロセスで完結する。B・C への読み取り専用オブザーバであり、
// モデル（C）を変更する経路を持たない。

export type { Diagnostic, Severity, SourceLocation } from "./types";
export { DiagnosticsCollector, DiagnosticReport } from "./collector";
export { checkIntegrity } from "./integrity";

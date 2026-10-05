// 診断1件を、診断パネルに表示するのと同じ1行/複数行の文字列にする。
// パネル表示とログファイル出力で内容を一致させるため、整形はここ1か所に置く。

import type { Diagnostic } from "./types";

export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}: ` : "";
  return `[${d.code}] ${loc}${d.message}`;
}

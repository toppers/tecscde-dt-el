// 診断1件を、診断パネルに表示するのと同じ文字列（1行表現）にする。
// パネル表示とログファイル出力で内容を一致させるため、整形はここ1か所に置く（監査#68）。

import type { Diagnostic } from "./types";

/**
 * 監査#68: メッセージ内の改行・バックスラッシュを可逆エスケープし、1診断1物理行にする。
 */
export function escapeSingleLine(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

export function unescapeSingleLine(text: string): string {
  return text.replace(/\\(\\|r|n)/g, (_, esc: string) => {
    if (esc === "\\") return "\\";
    if (esc === "r") return "\r";
    if (esc === "n") return "\n";
    return esc;
  });
}

export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}: ` : "";
  return escapeSingleLine(`[${d.code}] ${loc}${d.message}`);
}

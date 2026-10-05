// tecsgen が非0終了したとき、診断パネルとログに出す説明文を組み立てる。
// tecsgen は成功時にも Plugin の進捗を標準出力へ大量に出すため、出力の先頭を切り出しても
// 肝心のエラー行が含まれない。エラーらしい行を優先して拾い、無ければ出力の末尾を示す。

import type { TecsgenResult } from "../../shared/ipc-types.js";

const MAX_LINES = 10;
const MAX_LINE_LENGTH = 300;
const ERROR_LINE = /error|fatal|エラー/i;

function toLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line));
}

export function describeTecsgenFailure(result: Pick<TecsgenResult, "stdout" | "stderr" | "exitCode">): string {
  const lines = [...toLines(result.stderr), ...toLines(result.stdout)];
  const errors = [...new Set(lines.filter((line) => ERROR_LINE.test(line)))];
  const picked = errors.length > 0 ? errors.slice(0, MAX_LINES) : lines.slice(-MAX_LINES);
  const header = `tecsgen が失敗しました（終了コード ${result.exitCode ?? "不明"}）`;
  if (picked.length === 0) return header;
  const omitted = errors.length > MAX_LINES ? `\n…ほか ${errors.length - MAX_LINES} 件` : "";
  return `${header}:\n${picked.map((line) => `  ${line}`).join("\n")}${omitted}`;
}

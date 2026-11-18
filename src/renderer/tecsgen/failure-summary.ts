// tecsgen が非0終了したとき、診断パネルとログに出す説明文を組み立てる。
// tecsgen は成功時にも Plugin の進捗を標準出力へ大量に出すため、出力の先頭を切り出しても
// 肝心のエラー行が含まれない。エラーらしい行を優先して拾い、無ければ出力の末尾を示す。

import type { TecsgenLaunchFailure, TecsgenResult } from "../../shared/ipc-types.js";

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

/** 第9章9.7節: 起動失敗（見つからない・権限なし・タイムアウト・出力過多・その他）の利用者向け文言。 */
export function describeLaunchFailure(failure: TecsgenLaunchFailure): string {
  switch (failure.kind) {
    case "not-found":
      return (
        `tecsgen が見つかりません（実行ファイル '${failure.command}' が PATH 上、または TECSGEN_COMMAND の指定先に無い）。` +
        "「情報」のtecsgen設定から実行ファイルを指定してください。環境変数 TECSGEN_COMMAND を使う場合は設定後にアプリを再起動してください。"
      );
    case "permission":
      return `tecsgen を実行する権限がありません（実行ファイル '${failure.command}'、${failure.detail}）。実行権限と、ファイルが実行可能な形式かを確認してください。`;
    case "timeout":
      return `tecsgen が制限時間内に終了せず、強制終了されました（実行ファイル '${failure.command}'）。`;
    case "output-overflow":
      return `tecsgen の出力が上限を超えたため、強制終了されました（実行ファイル '${failure.command}'）。`;
    case "launch-error":
      return `tecsgen を起動できませんでした（実行ファイル '${failure.command}'、${failure.detail}）。`;
  }
}

/**
 * `error` を含まなくても、原因を指す行（tecsgen 内部の C プリプロセッサ・コンパイラの失敗、ファイルが無い、など）。
 * 構文エラーは、C の型が読めなかった結果として大量に出るので、その前にこの行を示す（2026-11-18）。
 */
const CAUSE_LINE = /\b(?:cpp|gcc|g\+\+|clang|cc1|preprocess\w*)\b|プリプロセ|No such file|cannot (?:execute|find|open)|not found|failed/i;
const MAX_CAUSE_LINES = 4;
/** 毎回出る注意書き（CDL に tecsgen の `__tool_info__` が無い、など）。原因ではない。 */
const NOISE_LINE = /^__tool_info__:/;

export function describeTecsgenFailure(result: Pick<TecsgenResult, "stdout" | "stderr" | "exitCode">): string {
  const lines = [...toLines(result.stderr), ...toLines(result.stdout)];
  const errors = [...new Set(lines.filter((line) => ERROR_LINE.test(line)))];
  const causes = [...new Set(lines.filter((line) => CAUSE_LINE.test(line) && !ERROR_LINE.test(line) && !NOISE_LINE.test(line)))]
    .slice(0, MAX_CAUSE_LINES);
  const picked = errors.length > 0 ? [...causes, ...errors.slice(0, MAX_LINES)] : lines.slice(-MAX_LINES);
  const header = `tecsgen が失敗しました（終了コード ${result.exitCode ?? "不明"}）`;
  if (picked.length === 0) return header;
  const omitted = errors.length > MAX_LINES ? `\n…ほか ${errors.length - MAX_LINES} 件` : "";
  return `${header}:\n${picked.map((line) => `  ${line}`).join("\n")}${omitted}`;
}

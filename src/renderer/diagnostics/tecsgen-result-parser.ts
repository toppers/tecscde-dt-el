// [[TECSCDE-DT-EL内部仕様]] 第9章9.4節 — tecsgen実行結果の診断への変換。
//
// [[work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 09 エラーと警告|TECSCDE外部仕様9.1.1・9.3.1]]が
// 定める固定書式をそのまま解析する。
//   <ファイル名>:<行>:<列>: error|warning: <メッセージ>
//   error|warning: <メッセージ>   （位置情報(locale)が取得できない場合、9.1.1）
// 文言そのもの（G-code/S-code含む）はtecsgenのメッセージカタログをそのまま用い、独自の
// 言い回しに置き換えない（9.1.2）。書式に一致しない行（tecsgenの通常の進捗出力等）は
// 診断化せず読み飛ばす——一覧を汚さないため。
//
// 解析結果は第8章の`DiagnosticsCollector.report()`へそのまま渡され、CDLインポート時の診断
// （モジュールB）・整合性チェック（モジュールH自身）と同じ一覧・同じジャンプ機構で提示される
// （呼び出し側=モジュールG、9.5節）。

import type { TecsgenResult } from "../../shared/ipc-types.js";
import type { Diagnostic, Severity } from "./types";

export const TECSGEN_CODES = {
  /** 2章2.4節・9.1節の新規制約: 実行ファイル自体が見つからない場合。 */
  NOT_FOUND: "E-TECSGEN-NOT-FOUND",
} as const;

const LOCATED_LINE = /^(.+):(\d+):(\d+):\s*(error|warning):\s*(.*)$/;
const UNLOCATED_LINE = /^(error|warning):\s*(.*)$/;
/** メッセージ本文が"G1015 ..."/"S1109 ..."のようにtecsgenのコードで始まる場合、codeへ分離する。 */
const LEADING_CODE = /^([A-Z]\d{3,5})\s+(.*)$/;

function splitLeadingCode(message: string): { code: string | undefined; message: string } {
  const m = LEADING_CODE.exec(message);
  return m ? { code: m[1], message: m[2]! } : { code: undefined, message };
}

export class TecsgenResultParser {
  /** `TecsgenRunner.run()`の結果を`Diagnostic[]`へ変換する。 */
  static parse(result: TecsgenResult): readonly Diagnostic[] {
    if (!result.executableFound) {
      return [
        {
          severity: "error",
          code: TECSGEN_CODES.NOT_FOUND,
          message: "実行ファイル 'tecsgen' が見つかりません（環境変数PATH上に存在しません）。",
        },
      ];
    }
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/);
    const diagnostics: Diagnostic[] = [];
    for (const line of lines) {
      const d = TecsgenResultParser.parseLine(line);
      if (d) diagnostics.push(d);
    }
    return diagnostics;
  }

  private static parseLine(line: string): Diagnostic | null {
    const located = LOCATED_LINE.exec(line);
    if (located) {
      const [, file, lineStr, columnStr, severityText, rawMessage] = located;
      const severity = severityText as Severity;
      const { code, message } = splitLeadingCode(rawMessage!);
      return {
        severity,
        code: code ?? severity.toUpperCase(),
        message,
        location: { file: file!, line: Number(lineStr), column: Number(columnStr) },
      };
    }
    const unlocated = UNLOCATED_LINE.exec(line);
    if (unlocated) {
      const [, severityText, rawMessage] = unlocated;
      const severity = severityText as Severity;
      const { code, message } = splitLeadingCode(rawMessage!);
      return { severity, code: code ?? severity.toUpperCase(), message };
    }
    return null;
  }
}

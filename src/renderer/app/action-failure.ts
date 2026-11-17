// 三者相違一覧 4-1・2-10・4-3・5-3・5-14・5-21（V0.2.6 段4、2026-11-17 決定）:
// 失敗・拒否を、診断一覧（と診断ログ）へ出す。ダイアログは出さない。
// 外部仕様9章の表に `E-SAVE-FAILED`・`E-OPEN-FAILED`・`E-ACTION-FAILED`・`W-SAVE-READONLY`・`W-OPTS-NO-CDL` を足した。

import { E_CODES, W_CODES } from "../cdl/messages";
import type { Diagnostic } from "../diagnostics";

/** 保存できなかったソースと、保存できたソース（一部失敗。4-1）。 */
export class SaveFailure extends Error {
  constructor(
    readonly failed: ReadonlyArray<{ readonly path: string; readonly reason: string }>,
    readonly saved: readonly string[],
  ) {
    super(failed.map((entry) => `${entry.path}: ${entry.reason}`).join("; "));
    this.name = "SaveFailure";
  }
}

/** 例外の理由を、利用者に見せる1行の文字列にする。 */
export function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SAVE_ACTIONS: ReadonlySet<string> = new Set(["save", "saveAs"]);
const OPEN_ACTIONS: ReadonlySet<string> = new Set(["openFolder", "addAsReference", "loadOptionsFile", "bootstrap"]);

/** `reportActionError`と起動時の読み込み失敗から呼ぶ。操作の種類で診断コードを選ぶ。 */
export function actionFailureDiagnostic(action: string, error: unknown): Diagnostic {
  if (SAVE_ACTIONS.has(action)) {
    if (error instanceof SaveFailure) {
      const failed = error.failed.map((entry) => `${entry.path}（${entry.reason}）`).join("、");
      const saved = error.saved.length > 0 ? `。保存できたファイル: ${error.saved.join("、")}` : "";
      return { severity: "error", code: E_CODES.SAVE_FAILED, message: `保存に失敗したファイル: ${failed}${saved}` };
    }
    return { severity: "error", code: E_CODES.SAVE_FAILED, message: `保存に失敗しました（${describeFailure(error)}）` };
  }
  if (action === "bootstrap") {
    return { severity: "error", code: E_CODES.OPEN_FAILED, message: `起動時のファイルの読み込みに失敗しました（${describeFailure(error)}）` };
  }
  if (OPEN_ACTIONS.has(action)) {
    return { severity: "error", code: E_CODES.OPEN_FAILED, message: `ファイルを開けませんでした（${describeFailure(error)}）` };
  }
  return { severity: "error", code: E_CODES.ACTION_FAILED, message: `操作「${action}」に失敗しました（${describeFailure(error)}）` };
}

/** 主ファイルが閲覧のみ（システム定義CDL）のため、主ファイルを保存しなかった（4-3）。 */
export function saveReadOnlyDiagnostic(path: string | null, savedReferences: readonly string[]): Diagnostic {
  const saved = savedReferences.length > 0 ? `編集した参照ファイル（${savedReferences.join("、")}）は保存しました。` : "保存するものはありませんでした。";
  return {
    severity: "warning",
    code: W_CODES.SAVE_READONLY,
    message: `主ファイル${path ? `（${path}）` : ""}は閲覧のみのため、保存していません。${saved}`,
  };
}

/** `.tecsgen-opts`にCDLが1件も書かれていないため、何も読み込まなかった（5-3）。 */
export function optionsNoCdlDiagnostic(path: string): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.OPTS_NO_CDL,
    message: `オプションファイル '${path}' に読み込むCDLが1件もないため、図は変えていません。`,
  };
}

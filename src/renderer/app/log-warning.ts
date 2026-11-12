// 外部仕様9.5.2の規定13・9.5節の表: ログを書けないときの警告 W-LOG-WRITE-FAILED。
// アプリを止めず、診断の一覧（画面）に一度だけ出す。ログには書かない（書けないため。
// DiagnosticsLogger がこのコードを除いて書き出す）。

import type { LogAppendResult } from "../../shared/ipc-types.js";
import type { Diagnostic } from "../diagnostics";
import type { AppStore } from "./store";

export const LOG_WRITE_FAILED_CODE = "W-LOG-WRITE-FAILED";

export function logWriteFailedDiagnostic(detail: string): Diagnostic {
  return {
    severity: "warning",
    code: LOG_WRITE_FAILED_CODE,
    message: `診断ログを書けません（${detail}）。診断パネルの内容は、ログファイルに残りません。`,
  };
}

/**
 * ログの追記を、main に頼んで行う関数。main が「新しい失敗」を知らせてきたときに、警告をストアへ入れる
 * （main が一度しか知らせないので、警告も一度）。IPC 自体の失敗は、そのまま呼び出し側へ返す。
 */
export function createLogAppender(
  gateway: { append(lines: readonly string[]): Promise<LogAppendResult | void> },
  store: Pick<AppStore, "setLogWriteWarning">,
): (lines: readonly string[]) => Promise<void> {
  return async (lines) => {
    const result = await gateway.append(lines);
    if (result && result.newFailure !== undefined) {
      store.setLogWriteWarning(logWriteFailedDiagnostic(result.newFailure));
    }
  };
}

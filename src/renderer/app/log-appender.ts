// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節, [[TECSCDE-DT外部仕様]] 第9章9.5節:
// LogService.appendの結果を受け取り、最初の書き込み失敗時にW-LOG-WRITE-FAILEDを画面へ通知する（監査#66）。

import type { LogAppendResult } from "../../shared/ipc-types";
import { logWriteFailed } from "../cdl/messages";
import type { AppStore } from "./store";

export interface LogAppender {
  append(lines: readonly string[]): Promise<LogAppendResult>;
}

export function createLogAppender(
  store: Pick<AppStore, "addEnvironmentDiagnostic">,
  gateway: { append(lines: readonly string[]): Promise<LogAppendResult> },
): LogAppender {
  return {
    async append(lines: readonly string[]): Promise<LogAppendResult> {
      try {
        const result = await gateway.append(lines);
        if (result.newFailure) {
          store.addEnvironmentDiagnostic(logWriteFailed());
        }
        return result;
      } catch (error) {
        store.addEnvironmentDiagnostic(logWriteFailed());
        return {
          success: false,
          newFailure: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

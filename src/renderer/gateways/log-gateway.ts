// ログファイル出力（main側 LogService）への薄いラッパ。
// プロセス境界はこのクラスの内部に閉じ込める（第2章2.4節）。

import type { LogAppendResult, LogKind } from "../../shared/ipc-types.js";

export class LogGateway {
  append(lines: readonly string[], kind?: LogKind): Promise<LogAppendResult> {
    return window.tecscde.log.append(lines, kind);
  }
}

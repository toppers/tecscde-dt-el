// ログファイル出力（main側 LogService）への薄いラッパ。
// プロセス境界はこのクラスの内部に閉じ込める（第2章2.4節）。

export class LogGateway {
  append(lines: readonly string[]): Promise<void> {
    return window.tecscde.log.append(lines);
  }
}

// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節・第2章2.4節: ClipboardGateway（renderer）。
// preloadが公開する`window.tecscde.clipboard`を経由し、mainプロセスの`clipboard`へipcMain（IPC）で
// 渡すOSクリップボードへの薄いラッパー。コマンドクラス（Copy/Paste/Cut）は呼ばず、
// `AppStore`のコピー・切り取り、`pasteFromClipboard`、シェル（情報ダイアログ等）が利用する。

export class ClipboardGateway {
  writeText(text: string): Promise<void> {
    return window.tecscde.clipboard.writeText(text);
  }

  readText(): Promise<string> {
    return window.tecscde.clipboard.readText();
  }
}

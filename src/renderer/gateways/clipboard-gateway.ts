// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節・第2章2.4節: ClipboardGateway（renderer）。
// ipcMainを介さず、preloadが直接ブリッジしたOSクリップボードへの薄いラッパー。
// CopyCommand/PasteCommand/CutCommand から利用する（第4章）。

export class ClipboardGateway {
  writeText(text: string): void {
    window.tecscde.clipboard.writeText(text);
  }

  readText(): string {
    return window.tecscde.clipboard.readText();
  }
}

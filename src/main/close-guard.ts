// [[TECSCDE-DT-EL内部仕様]] 第7章7.9節: ウィンドウを閉じるときの未保存確認。
// ブラウザの`beforeunload`には頼らず、mainのウィンドウの`close`イベントで確認する。
// rendererは未保存かどうかが変わるたびに`setDirty`で知らせておく（`close`の同期的な
// 中断と、rendererへの非同期の問い合わせは噛み合わないため）。

/** `BrowserWindow`のうち、`CloseGuard`が使う部分だけ（テストで差し替えられるようにする）。 */
export interface CloseGuardWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  close(): void;
}

export class CloseGuard {
  private dirty = false; // rendererが最後に知らせた値
  private confirmed = false; // 利用者が「保存せずに終了」を選んだ
  private asking = false; // ダイアログ表示中（二重表示を防ぐ）

  /**
   * @param confirmDiscard 「保存せずに終了」ならtrue、「キャンセル」ならfalseを返す確認ダイアログ。
   */
  constructor(
    private readonly win: CloseGuardWindow,
    private readonly confirmDiscard: () => Promise<boolean>,
  ) {
    win.on("close", (event) => {
      if (!this.dirty || this.confirmed) return; // そのまま閉じる
      event.preventDefault();
      void this.confirmAndClose();
    });
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  private async confirmAndClose(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      if (await this.confirmDiscard()) {
        this.confirmed = true;
        this.win.close();
      }
    } finally {
      this.asking = false;
    }
  }
}

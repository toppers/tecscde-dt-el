// [[TECSCDE-DT-EL内部仕様]] 第7章7.9節: ウィンドウを閉じるときの未保存確認のため、
// 未保存かどうかをmain（CloseGuard）へ知らせる。プロセス境界はこのクラスに閉じ込める。

export class WindowGateway {
  setDirty(dirty: boolean): void {
    window.tecscde.window.setDirty(dirty);
  }
}

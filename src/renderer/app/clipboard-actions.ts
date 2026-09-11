// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節 — OSクリップボードからの貼り付けの非同期入口。
// `AppStore.pasteClipboard()`は解決済みのテキストを受け取る同期API（コマンド階層は同期のまま
// 保つため、[[TECSCDE-DT-EL PasteCommand非同期クリップボード決定]]）なので、ここで
// `ClipboardGateway.readText()`を解決してから渡す。Copy/Cutは書き込みの完了を待つ必要が
// ないため、この非同期ラッパーを必要とせず`AppStore.copySelection`/`cutSelection`を直接呼べる。

import type { ClipboardGateway } from "../gateways/clipboard-gateway";
import type { AppStore } from "./store";

export async function pasteFromClipboard(store: AppStore, clipboard: Pick<ClipboardGateway, "readText">): Promise<void> {
  const text = await clipboard.readText();
  store.pasteClipboard(text);
}

// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— renderer プロセスのエントリポイント。
// esbuild が本ファイルを起点に単一バンドル（dist/renderer/renderer.js）を生成し、
// index.html が `<script type="module">` で読み込む（[[TECSCDE-実装アーキテクチャ案]] 7項）。
//
// 起動時のドキュメントは main プロセスが `app:bootstrap` で送ってくる（第7章7.4節:
// コマンドライン引数・ファイル関連付けの経路。引数が無ければ samples を送る）。

import { FileGateway } from "./gateways/file-gateway";
import { AppStore } from "./app/store";
import { AppShell } from "./app/shell";
import { applyOpenResult } from "./app/file-actions";

function main(): void {
  if (typeof window === "undefined" || !window.tecscde) {
    throw new Error("preload の window.tecscde が見つかりません（contextBridge 未初期化）");
  }

  const store = new AppStore();
  const gateway = new FileGateway();
  const shell = new AppShell({ root: document, store, gateway, win: window });
  shell.start();

  // main からの起動ドキュメント（pendingOpenPath 経路 or samples）。
  window.tecscde.onBootstrap((data) => {
    if (data) applyOpenResult(store, data);
  });
}

main();

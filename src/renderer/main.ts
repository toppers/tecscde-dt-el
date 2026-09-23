// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— renderer プロセスのエントリポイント。
// esbuild が本ファイルを起点に単一バンドル（dist/renderer/renderer.js）を生成し、
// index.html が `<script type="module">` で読み込む（[[TECSCDE-実装アーキテクチャ案]] 7項）。
//
// 起動時のドキュメントは main プロセスが `app:bootstrap` で送ってくる（第7章7.4節:
// コマンドライン引数・ファイル関連付けの経路。引数が無ければ samples を送る）。

import { FileGateway } from "./gateways/file-gateway";
import { ClipboardGateway } from "./gateways/clipboard-gateway";
import { TecsgenGateway } from "./gateways/tecsgen-gateway";
import { AppStore } from "./app/store";
import { AppShell } from "./app/shell";
import { applyOpenResult } from "./app/file-actions";
import { CdlGrammar } from "./cdl/grammar";
import { CdeclGrammar } from "./cdecl/grammar";

function main(): void {
  if (typeof window === "undefined" || !window.tecscde) {
    throw new Error("preload の window.tecscde が見つかりません（contextBridge 未初期化）");
  }

  // 内部仕様2.2 / 9B章9B.3: WASMロードの非同期性は起動時の1点に閉じ込める。
  // onBootstrapはdid-finish-load直後に届くため先に登録し、解析だけ初期化完了を待つ。
  // CdlGrammar/CdeclGrammarのinit()はいずれもweb-tree-sitterのグローバルランタイムを
  // 初期化するため、並列に走らせると競合する（tests/setup.tsコメント参照）。順番に待つ。
  const grammarReady = window.tecscde.cdl.loadGrammarAssets().then(async (assets) => {
    await CdlGrammar.init(assets);
    await CdeclGrammar.init({ runtimeWasm: assets.runtimeWasm, cdeclWasm: assets.cdeclWasm });
  });

  const store = new AppStore();
  const gateway = new FileGateway();
  const clipboard = new ClipboardGateway();
  const tecsgen = new TecsgenGateway();
  const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, win: window });
  shell.start();

  // main からの起動ドキュメント（pendingOpenPath 経路 or samples）。
  window.tecscde.onBootstrap((data) => {
    void grammarReady
      .then(() => {
        if (data) return applyOpenResult(store, gateway, tecsgen, data);
      })
      .catch((error: unknown) => {
        console.error("CDL/cdeclパーサの初期化に失敗しました:", error);
      });
  });
}

main();

// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— renderer プロセスのエントリポイント。
// esbuild が本ファイルを起点に単一バンドル（dist/renderer/renderer.js）を生成し、
// index.html が `<script type="module">` で読み込む（[[TECSCDE-実装アーキテクチャ案]] 7項）。
//
// 起動時のドキュメントは main プロセスが `app:bootstrap` で送ってくる（第7章7.4節:
// コマンドライン引数・ファイル関連付けの経路。引数が無ければ samples を送る）。

import { FileGateway } from "./gateways/file-gateway";
import { ClipboardGateway } from "./gateways/clipboard-gateway";
import { TecsgenGateway } from "./gateways/tecsgen-gateway";
import { LogGateway } from "./gateways/log-gateway";
import { DiagnosticsLogger } from "./app/diagnostics-logger";
import { AppStore } from "./app/store";
import { WindowGateway } from "./gateways/window-gateway";
import { SettingsGateway } from "./gateways/settings-gateway";
import { AppShell } from "./app/shell";
import { checkTecsgenVersion } from "./app/tecsgen-version";
import { applyOpenResult } from "./app/file-actions";
import { CdlGrammar } from "./cdl/grammar";
import { CdeclGrammar } from "./cdecl/grammar";
import { SVG_STYLES } from "./render/svg-styles";

function main(): void {
  if (typeof window === "undefined" || !window.tecscde) {
    throw new Error("preload の window.tecscde が見つかりません（contextBridge 未初期化）");
  }

  const diagramStyle = document.createElement("style");
  diagramStyle.textContent = SVG_STYLES;
  document.head.append(diagramStyle);

  // 内部仕様2.2 / 9B章9B.3: WASMロードの非同期性は起動時の1点に閉じ込める。
  // onBootstrapはdid-finish-load直後に届くため先に登録し、解析だけ初期化完了を待つ。
  // CdlGrammar/CdeclGrammarのinit()はいずれもweb-tree-sitterのグローバルランタイムを
  // 初期化するため、並列に走らせると競合する（tests/setup.tsコメント参照）。順番に待つ。
  const grammarReady = window.tecscde.cdl.loadGrammarAssets().then(async (assets) => {
    await CdlGrammar.init(assets);
    await CdeclGrammar.init({ runtimeWasm: assets.runtimeWasm, cdeclWasm: assets.cdeclWasm });
  });

  const store = new AppStore();
  // 第3章3.2節: システム定義CDLを編集可能にする設定。起動ドキュメントを読み込む前に反映する。
  const settingsReady = new SettingsGateway()
    .get()
    .then((settings) => store.setAllowEditSystemDefined(settings.allowEditSystemDefined))
    .catch((error: unknown) => console.error("設定の読み込みに失敗しました:", error));
  const gateway = new FileGateway();
  const clipboard = new ClipboardGateway();
  const tecsgen = new TecsgenGateway();
  const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, windowGateway: new WindowGateway(), runtimeVersions: window.tecscde.versions, win: window });
  shell.start();

  // 診断パネルに出る内容を、ログファイルにも同じ文面で残す。
  const logger = new DiagnosticsLogger(store, (lines) => new LogGateway().append(lines));
  store.subscribe(() => logger.sync());

  // 第9C章: 起動時にtecsgenの版を一度だけ確認する（UIをブロックしない。見つからなければ何も出さない）。
  void checkTecsgenVersion(store, tecsgen, new LogGateway(), () => shell.openDiagnostics());

  // main からの起動ドキュメント（pendingOpenPath 経路 or samples）。
  window.tecscde.onBootstrap((data) => {
    void Promise.all([grammarReady, settingsReady])
      .then(() => {
        if (data) return applyOpenResult(store, gateway, tecsgen, data);
      })
      .catch((error: unknown) => {
        console.error("CDL/cdeclパーサの初期化に失敗しました:", error);
      });
  });
}

main();

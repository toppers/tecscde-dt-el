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
import { createLogAppender } from "./app/log-appender";
import { AppStore } from "./app/store";
import { WindowGateway } from "./gateways/window-gateway";
import { SettingsGateway } from "./gateways/settings-gateway";
import { AppShell } from "./app/shell";
import { checkTecsgenVersion } from "./app/tecsgen-version";
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
  // Bootstrap owns the initial request before any user interaction or async initialization.
  const bootstrapGuard = store.beginLoad();
  let closeQuery: string | undefined;
  const unbindClose = window.tecscde.window.onRequestCloseState((queryId) => {
    closeQuery = queryId;
    void store.prepareClose().then(() => {
      if (closeQuery !== queryId) return;
      window.tecscde.window.replyCloseState({ kind: "ready", queryId,
        documentEpoch: store.documentEpoch, historyNodeId: store.history.nodeId,
        dirty: store.isDirty(), pendingSaves: 0 });
    }).catch(() => {
      if (closeQuery === queryId) window.tecscde.window.replyCloseState({ kind: "unavailable", queryId });
    });
  });
  const unbindCancel = window.tecscde.window.onCancelCloseState((queryId) => {
    if (closeQuery !== queryId) return;
    closeQuery = undefined;
    store.cancelClose();
  });
  window.addEventListener("unload", () => { unbindClose(); unbindCancel(); }, { once: true });
  // 第3章3.2節: システム定義CDLを編集可能にする設定。起動ドキュメントを読み込む前に反映する。
  const settings = new SettingsGateway();
  const settingsReady = settings
    .get()
    .then((settings) => store.setAllowEditSystemDefined(settings.allowEditSystemDefined))
    .catch((error: unknown) => console.error("設定の読み込みに失敗しました:", error));
  const gateway = new FileGateway();
  const clipboard = new ClipboardGateway();
  const tecsgen = new TecsgenGateway();
  const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, settings, windowGateway: new WindowGateway(), win: window });
  shell.start();

  // 診断パネルに出る内容を、ログファイルにも同じ文面で残す。
  // 初回失敗時に W-LOG-WRITE-FAILED を通知する logAppender 経由で書き込む（監査#66）。
  const logAppender = createLogAppender(store, new LogGateway());
  const logger = new DiagnosticsLogger(store, (lines) => logAppender.append(lines));
  store.subscribe(() => logger.sync());

  // 第9C章: 起動時にtecsgenの版を一度だけ確認する（UIをブロックしない。見つからなければ何も出さない）。
  void settings.getToolSettings().then((tool) =>
    checkTecsgenVersion(store, tecsgen, logAppender, () => shell.openDiagnostics(), tool.effectiveCommand, tool.revision))
    .catch((error: unknown) => console.error("tecsgen設定の読み込みに失敗しました:", error));

  // main からの起動ドキュメント（pendingOpenPath 経路 or samples）。
  window.tecscde.onBootstrap((data) => {
    void Promise.all([grammarReady, settingsReady])
      .then(() => {
        if (data) return applyOpenResult(store, gateway, tecsgen, data, data.extraImportPaths, bootstrapGuard);
      })
      .catch((error: unknown) => {
        console.error("CDL/cdeclパーサの初期化に失敗しました:", error);
      });
  });
}

main();

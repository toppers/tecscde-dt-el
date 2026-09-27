// [[TECSCDE-DT-EL内部仕様]] 第7章7.4節・第10章: 起動処理・BrowserWindow生成・
// コマンドライン引数/open-fileの処理。
//
// `electron .` による起動は 2026-09-08 に Electron 44 で確認済み
// （4プロセス構成で起動、preload も ESM でロード成功）。
// 詳細・残課題は [[work/active/TECSCDE-DT-EL実装]] の Notes を参照。

import { app, BrowserWindow, Menu } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { updateElectronApp } from "update-electron-app";
import { FileService } from "./file-service.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { registerIpcHandlers } from "./ipc.js";
import { loadAppSettings, saveAppSettings } from "./app-settings.js";
import type { OpenResult } from "../shared/ipc-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Electron Forge の Squirrel(Windows) maker が発行するインストール/アンインストール
// イベントでは、ショートカット作成等の処理だけ行ってすぐ終了する必要がある
// （electron-squirrel-startup は CJS 製のため preload と同じ createRequire 経由で読む、
// [[work/active/tecs/TECSCDE-DT-EL preload ESM・sandbox決定]]と同型のパターン）。
const require = createRequire(import.meta.url);
if (require("electron-squirrel-startup")) {
  app.quit();
}

// [[work/active/tecs/TECSCDE-DT-EL 配布アーキテクチャ決定]]（2026-09-23）:
// origin（toppers/tecscde-dt-el、public）のGitHub Releasesを自動更新元とする。
// update-electron-app は内部でapp.isPackagedを見て未パッケージ時は更新自体をno-opにするが、
// その判定より前に入力検証（validateInput→guessRepo）を通すため、repoを明示しないと
// package.jsonのrepositoryフィールド欠如で`npm start`が起動時に例外を投げてしまう
// （実機確認、2026-09-26）。forge.config.jsのpublisher-github設定と同じrepoを渡す。
updateElectronApp({ repo: "toppers/tecscde-dt-el" });

let pendingOpenPath: string | null = null;

// Windows/Linux: コマンドライン引数、または .cde/.cdl ファイルの「アプリで開く」
const argPath = process.argv.find((a) => a.endsWith(".cde") || a.endsWith(".cdl"));
if (argPath) pendingOpenPath = argPath;

// macOS: Dockアイコンへのドロップ、Finderでの「このアプリで開く」
app.on("open-file", (event, path) => {
  event.preventDefault();
  pendingOpenPath = path;
});

/** 起動ドキュメントの最終フォールバック（コマンドライン引数・前回セッションのいずれも無い場合）。 */
async function loadSamples(fileService: FileService): Promise<OpenResult> {
  const samples = join(app.getAppPath(), "public", "samples");
  // openPaths()は「最後のパスが編集対象、他は参照専用」（file-service.ts参照）。
  // セル実体を持つmain.cdeを編集対象にするため最後に置く（celltypes.cdlは
  // セルタイプ定義のみの参照専用ファイル）。
  return fileService.openPaths([join(samples, "celltypes.cdl"), join(samples, "main.cde")]);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 第11章11.2節#1の決定（2026-09-08）: preload を ESM（`.mjs`）で書く方針を
      // 採ったため、sandbox は false。Electron のサンドボックス化された preload は
      // ESM import を使えず、ESM preload には sandbox: false が必須。
      // contextIsolation: true と nodeIntegration: false は維持しているので、
      // renderer から Node/Electron API へ触れる経路は依然 contextBridge 経由のみ。
      sandbox: false,
    },
  });

  // Electronは既定でChromiumのネイティブ「Ctrl+ホイール／ピンチでページ全体を光学ズーム」
  // を有効にしたままにする。第7章のCtrl+ホイールズーム（ポインタ固定点でモデルの表示倍率を
  // 変える、rendererのview-state.tsが管理）とは全くの別機構で、preventDefault()では止まらない。
  // 本アプリはCtrl+ホイールを自前のズームに使うため、ネイティブ側は無効化し二重の解釈が
  // 起きないようにする（2026-09-21、対話的確認の過程で存在に気づいた。実際に競合していたと
  // 確認したわけではないが、有効なままにする理由もない）。
  win.webContents.setVisualZoomLevelLimits(1, 1);

  const fileService = new FileService(win);
  const tecsgenRunner = new TecsgenRunner();
  registerIpcHandlers(fileService, tecsgenRunner);

  // モジュールG（renderer HTMLシェル）の成果物。`npm run build:renderer` が esbuild で
  // dist/renderer/{index.html,renderer.js} を出力する。
  win.loadFile(join(__dirname, "../renderer/index.html")).catch((err: unknown) => {
    console.error("renderer の読み込みに失敗しました（build:renderer 未実行の可能性）:", err);
  });

  // 7.4節・第7C章7.7.1節: renderer 初期化完了後、起動ドキュメントを一度だけ送る。
  // 優先順位: コマンドライン引数／ファイル関連付け(pendingOpenPath) > 前回セッション(lastSession) > samples。
  win.webContents.once("did-finish-load", async () => {
    try {
      let data: OpenResult;
      if (pendingOpenPath) {
        data = await fileService.openPath(pendingOpenPath);
        pendingOpenPath = null;
        // 7.7.1節: 起動時オープン（第7章7.4節）も前回セッションの保存対象——
        // 次回、引数無しで起動した際にこのファイルを復元できるようにする。
        await saveAppSettings({
          lastSession: {
            editablePath: data.editable.path,
            referencePaths: data.references.map((r) => r.path),
          },
        });
      } else {
        const settings = await loadAppSettings();
        const lastSession = settings.lastSession;
        if (lastSession?.editablePath) {
          // 7.7.1節「復元失敗時」: 記憶されたパスが存在しない・読めない場合は
          // エラーにせず次善のフォールバック（samples）へ進む。
          data = await fileService
            .openPaths([...lastSession.referencePaths, lastSession.editablePath])
            .catch(() => loadSamples(fileService));
        } else {
          data = await loadSamples(fileService);
        }
      }
      win.webContents.send("app:bootstrap", data);
    } catch (err) {
      console.error("起動ドキュメントの読み込みに失敗しました:", err);
      win.webContents.send("app:bootstrap", null);
    }
  });

  // 7.6.6節: 記憶済みのファイルブラウザのルートフォルダがあれば、起動ドキュメントと
  // 同じタイミングで一度だけ送る。前回の選択が無ければ何も送らない。
  // primeLastChosenFolder()も併せて呼ぶ——呼ばないと、ファイルブラウザ自体は前回のルートを
  // 正しく復元するのに、次に「フォルダを開く」を押した際のダイアログ初期位置だけOS既定の
  // ディレクトリに戻ってしまう（実機確認で発見、2026-09-21）。
  win.webContents.once("did-finish-load", async () => {
    const settings = await loadAppSettings();
    if (settings.fileBrowserRoot) {
      fileService.primeLastChosenFolder(settings.fileBrowserRoot);
      win.webContents.send("app:fileBrowserRoot", settings.fileBrowserRoot);
    }
  });

  return win;
}

// Electronの既定メニューはEdit（Cut/Copy/Paste/Undo/Redo）にCtrl/Cmd+X/C/V/Zの
// アクセラレータを持ち、renderer側のkeydownリスナへ届く前に横取りしてしまう
// （実機確認で判明: 第4章4.1節のセルCut/Copy/Pasteが常に無反応になっていた）。
// このアプリは独自のショートカットをDOM側で処理するため、既定メニュー自体を外す。
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

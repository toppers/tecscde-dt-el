// [[TECSCDE-DT-EL内部仕様]] 第7章7.4節・第10章: 起動処理・BrowserWindow生成・
// コマンドライン引数/open-fileの処理。
//
// `electron .` による起動は 2026-09-08 に Electron 44 で確認済み
// （4プロセス構成で起動、preload も ESM でロード成功）。
// 詳細・残課題は [[work/active/TECSCDE-DT-EL実装]] の Notes を参照。

import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { IpcMainEvent } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { updateElectronApp } from "update-electron-app";
import { FileService } from "./file-service.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { ToolSettingsService } from "./tool-settings.js";
import { LogService, pruneOldLogs } from "./log-service.js";
import { registerIpcHandlers } from "./ipc.js";
import { CloseGuard } from "./close-guard.js";
import { restoreSession } from "./session-restore.js";
import { createCloseStateQuery } from "./close-state-bridge.js";
import { loadAppSettings, logsDirectory } from "./app-settings.js";
import type { OpenResult } from "../shared/ipc-types.js";
import { fileKind } from "../shared/file-kind.js";

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

// 診断ログ: 設定フォルダ配下の logs/（Windows: %LOCALAPPDATA%/tecscde-dt-el/logs）へ固定。
// 起動時に古いログを刈り込み（最大30個）、直近のログを保持する（監査#64, #65）。
const logsDir = logsDirectory();
void pruneOldLogs(logsDir);
const logService = new LogService(logsDir, app.getVersion());

let pendingOpenPath: string | null = null;

// Windows/Linux: コマンドライン引数、または .cde/.cdl/.tecsgen-opts ファイルの「アプリで開く」
const argPath = process.argv.find(
  (a) => fileKind(a) !== undefined,
);
if (argPath) pendingOpenPath = argPath;

// macOS: Dockアイコンへのドロップ、Finderでの「このアプリで開く」
app.on("open-file", (event, path) => {
  event.preventDefault();
  pendingOpenPath = path;
});

/** 起動ドキュメントの最終フォールバック（コマンドライン引数・前回セッションのいずれも無い場合）。 */
async function loadSamples(fileService: FileService): Promise<OpenResult> {
  const samples = join(app.getAppPath(), "public", "samples");
  // Both sample CDL files are editable; the last file remains the primary save target.
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

  // 第7章7.9節: 未保存の変更があるままウィンドウを閉じようとしたら確認する。
  // rendererの`beforeunload`は実機で確認なしに終了したため使わず、mainの`close`で止める。
  const fileService = new FileService(win);
  const closeBridge = createCloseStateQuery(ipcMain, win.webContents);
  const closeGuard = new CloseGuard(win, async (unknownState) => {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["保存せずに終了", "キャンセル"],
      defaultId: 1,
      cancelId: 1,
      message: unknownState ? "保存状態を確認できません" : "未保存の変更があります",
      detail: "保存せずに終了すると、現在の変更内容は失われます。",
    });
    return result.response === 0;
  }, {
    queryState: (id) => closeBridge.queryState(id),
    stopWrites: async () => { fileService.setWriteAcceptance(false); await fileService.waitForWrites(); },
    resume: (id) => { fileService.setWriteAcceptance(true); closeBridge.cancel(id); },
  });
  const onSetDirty = (event: IpcMainEvent, dirty: unknown): void => {
    if (event.sender === win.webContents) closeGuard.setDirty(dirty === true);
  };
  ipcMain.on("window:setDirty", onSetDirty);
  win.on("closed", () => ipcMain.removeListener("window:setDirty", onSetDirty));

  win.on("closed", () => { closeGuard.dispose(); closeBridge.dispose(); });
  const toolSettings = new ToolSettingsService();
  const tecsgenRunner = new TecsgenRunner(() => toolSettings.resolveCommand());
  registerIpcHandlers(fileService, tecsgenRunner, logService, toolSettings, win);

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
        if (fileKind(pendingOpenPath) === "options") {
          const parsed = await fileService.parseTecsgenOptionsFile(pendingOpenPath);
          const [last, ...rest] = [...parsed.cdlFiles].reverse();
          if (last) {
            const opened = await fileService.openPaths([...rest.reverse(), last]);
            data = {
              ...opened,
              extraImportPaths: parsed.importPaths,
              optionsFilePath: pendingOpenPath,
              ...(parsed.systemDirs.length > 0 ? { systemDirs: parsed.systemDirs } : {}),
            };
          } else {
            data = await loadSamples(fileService);
          }
        } else {
          data = await fileService.openPath(pendingOpenPath);
        }
        pendingOpenPath = null;
      } else {
        const settings = await loadAppSettings();
        data = settings.lastSession
          ? await restoreSession(fileService, settings.lastSession).catch(() => loadSamples(fileService))
          : await loadSamples(fileService);
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

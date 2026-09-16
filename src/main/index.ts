// [[TECSCDE-DT-EL内部仕様]] 第7章7.4節・第10章: 起動処理・BrowserWindow生成・
// コマンドライン引数/open-fileの処理。
//
// `electron .` による起動は 2026-09-08 に Electron 44 で確認済み
// （4プロセス構成で起動、preload も ESM でロード成功）。
// 詳細・残課題は [[work/active/TECSCDE-DT-EL実装]] の Notes を参照。

import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { FileService } from "./file-service.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { registerIpcHandlers } from "./ipc.js";
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

let pendingOpenPath: string | null = null;

// Windows/Linux: コマンドライン引数、または .cde/.cdl ファイルの「アプリで開く」
const argPath = process.argv.find((a) => a.endsWith(".cde") || a.endsWith(".cdl"));
if (argPath) pendingOpenPath = argPath;

// macOS: Dockアイコンへのドロップ、Finderでの「このアプリで開く」
app.on("open-file", (event, path) => {
  event.preventDefault();
  pendingOpenPath = path;
});

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

  const fileService = new FileService(win);
  const tecsgenRunner = new TecsgenRunner();
  registerIpcHandlers(fileService, tecsgenRunner);

  // モジュールG（renderer HTMLシェル）の成果物。`npm run build:renderer` が esbuild で
  // dist/renderer/{index.html,renderer.js} を出力する。
  win.loadFile(join(__dirname, "../renderer/index.html")).catch((err: unknown) => {
    console.error("renderer の読み込みに失敗しました（build:renderer 未実行の可能性）:", err);
  });

  // 7.4節: renderer 初期化完了後、起動ドキュメントを一度だけ送る。
  // コマンドライン引数／ファイル関連付けがあればそのファイル、無ければ samples。
  win.webContents.once("did-finish-load", async () => {
    try {
      let data: OpenResult;
      if (pendingOpenPath) {
        data = await fileService.openPath(pendingOpenPath);
        pendingOpenPath = null;
      } else {
        const samples = join(app.getAppPath(), "public", "samples");
        data = await fileService.openPaths([join(samples, "main.cde"), join(samples, "main.cde")]);
      }
      win.webContents.send("app:bootstrap", data);
    } catch (err) {
      console.error("起動ドキュメントの読み込みに失敗しました:", err);
      win.webContents.send("app:bootstrap", null);
    }
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

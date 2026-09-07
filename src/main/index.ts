// [[TECSCDE-DT-EL内部仕様]] 第7章7.4節・第10章: 起動処理・BrowserWindow生成・
// コマンドライン引数/open-fileの処理。
//
// `electron .` による起動は 2026-09-08 に Electron 44 で確認済み
// （4プロセス構成で起動、preload も ESM でロード成功）。
// 詳細・残課題は [[work/active/TECSCDE-DT-EL実装]] の Notes を参照。

import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FileService } from "./file-service.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { registerIpcHandlers } from "./ipc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  // renderer/ 側のビルド成果物は未セットアップ（第11章の対象外）。
  // 実装が進んだらここで index.html をロードし、pendingOpenPath を
  // renderer初期化完了後にIPCで送る（7.4節）。
  void win.loadFile(join(__dirname, "../renderer/index.html")).catch(() => {
    // renderer未ビルドの間は起動確認のみを目的とし、読み込み失敗は無視する。
  });

  win.webContents.once("did-finish-load", () => {
    if (pendingOpenPath) {
      win.webContents.send("app:pendingOpenPath", pendingOpenPath);
      pendingOpenPath = null;
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

// [[TECSCDE-DT-EL内部仕様]] 第7章7.4節・第10章: 起動処理・BrowserWindow生成・
// コマンドライン引数/open-fileの処理。
//
// 注意（未検証・unverified）: このファイルは spec 通りの構造で書かれているが、
// GUI環境がないこの開発環境では `electron .` による実際の起動確認はできていない。
// [[work/active/TECSCDE-DT-EL実装]] の Notes を参照。

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
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: 未検証（第11章11.2節#1）。既定値（false）のまま。
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

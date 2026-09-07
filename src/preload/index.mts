// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: contextBridge.exposeInMainWorld による
// `window.tecscde` API の定義点。ipcMainを介す処理（file・tecsgen）と、
// Node/ElectronのAPIを直接ブリッジするだけの処理（clipboard）の両方をここに置く。

import { contextBridge, ipcRenderer } from "electron";
import { createRequire } from "node:module";
import type { OpenResult, TecsgenResult, TecscdeApi } from "../shared/ipc-types.js";

// ESM preload（第11章11.2節#1の決定）では、Electronの ESM `electron` モジュールが
// renderer/preload 向けに名前付きエクスポートするのは contextBridge / ipcRenderer /
// webFrame / webUtils / nativeImage / crashReporter に限られ、`clipboard` は含まれない。
// 非サンドボックス preload なら CJS 版 `require("electron")` から取得できるため、
// createRequire で橋渡しする（sandbox: false を前提、main/index.ts 参照）。
const { clipboard } = createRequire(import.meta.url)("electron") as typeof import("electron");

const api: TecscdeApi = {
  file: {
    open: (): Promise<OpenResult | null> => ipcRenderer.invoke("file:open"),
    save: (path: string, content: string): Promise<void> => ipcRenderer.invoke("file:save", path, content),
    saveAs: (content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:saveAs", content, suggestedName),
    export: (path: string, data: string): Promise<void> => ipcRenderer.invoke("file:export", path, data),
  },
  tecsgen: {
    generate: (args: readonly string[]): Promise<TecsgenResult> => ipcRenderer.invoke("tecsgen:generate", args),
    version: (): Promise<string | null> => ipcRenderer.invoke("tecsgen:version"),
  },
  // clipboardはipcMainを介さず、preloadから直接ブリッジできる
  // （Electronのclipboardモジュールはpreloadコンテキストで直接利用可能なため）
  clipboard: {
    writeText: (text: string): Promise<void> => clipboard.writeText(text),
    readText: (): Promise<string> => clipboard.readText(),
  },
};

contextBridge.exposeInMainWorld("tecscde", api);

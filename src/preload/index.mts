// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: contextBridge.exposeInMainWorld による
// `window.tecscde` API の定義点。file・tecsgen・clipboardいずれもipcMain経由。

import { contextBridge, ipcRenderer } from "electron";
import type { OpenResult, TecsgenResult, CppResult, TecscdeApi } from "../shared/ipc-types.js";

const api: TecscdeApi = {
  cdl: {
    loadGrammarAssets: () => ipcRenderer.invoke("cdl:grammar-assets"),
  },
  file: {
    open: (): Promise<OpenResult | null> => ipcRenderer.invoke("file:open"),
    save: (path: string, content: string): Promise<void> => ipcRenderer.invoke("file:save", path, content),
    saveAs: (content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:saveAs", content, suggestedName),
    export: (path: string, data: string): Promise<void> => ipcRenderer.invoke("file:export", path, data),
  },
  tecsgen: {
    generate: (args: readonly string[]): Promise<TecsgenResult> => ipcRenderer.invoke("tecsgen:generate", args),
    preprocess: (headerPath: string, cppCommand?: string): Promise<CppResult> =>
      ipcRenderer.invoke("tecsgen:preprocess", headerPath, cppCommand),
    version: (): Promise<string | null> => ipcRenderer.invoke("tecsgen:version"),
  },
  // 実機確認で判明: preloadに公開される`electron`モジュールにはclipboardが
  // 含まれない（ESM/CJS問わず）ため、file/tecsgenと同様にipcMain経由にする。
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
    readText: (): Promise<string> => ipcRenderer.invoke("clipboard:readText"),
  },
  // 第7章7.4節: main が did-finish-load 後に一度だけ送る起動ドキュメント。
  onBootstrap: (listener: (data: OpenResult | null) => void): void => {
    ipcRenderer.once("app:bootstrap", (_event, data: OpenResult | null) => listener(data));
  },
};

contextBridge.exposeInMainWorld("tecscde", api);

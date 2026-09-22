// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: contextBridge.exposeInMainWorld による
// `window.tecscde` API の定義点。file・tecsgen・clipboardいずれもipcMain経由。

import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenResult,
  TecsgenResult,
  CppResult,
  TecscdeApi,
  DirEntry,
  ImportRequest,
  ImportResolutionOptions,
  ResolvedImport,
  TecsgenOptionsFile,
} from "../shared/ipc-types.js";

const api: TecscdeApi = {
  cdl: {
    loadGrammarAssets: () => ipcRenderer.invoke("cdl:grammar-assets"),
  },
  file: {
    save: (path: string, content: string): Promise<void> => ipcRenderer.invoke("file:save", path, content),
    saveAs: (content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:saveAs", content, suggestedName),
    export: (path: string, data: string): Promise<void> => ipcRenderer.invoke("file:export", path, data),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("file:chooseFolder"),
    listDirectory: (dirPath: string): Promise<readonly DirEntry[]> => ipcRenderer.invoke("file:listDirectory", dirPath),
    openPath: (path: string): Promise<OpenResult> => ipcRenderer.invoke("file:openPath", path),
    confirmDiscardChanges: (): Promise<boolean> => ipcRenderer.invoke("file:confirmDiscardChanges"),
    saveSession: (editablePath: string | null, referencePaths: readonly string[]): Promise<void> =>
      ipcRenderer.invoke("file:saveSession", editablePath, referencePaths),
    resolveImports: (
      editablePath: string,
      requests: readonly ImportRequest[],
      options: ImportResolutionOptions,
    ): Promise<readonly ResolvedImport[]> => ipcRenderer.invoke("file:resolveImports", editablePath, requests, options),
    parseTecsgenOptionsFile: (path: string): Promise<TecsgenOptionsFile> =>
      ipcRenderer.invoke("file:parseTecsgenOptionsFile", path),
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
  // 第7章7.6.6節: 記憶済みのファイルブラウザのルートフォルダ。前回の選択が無ければ送られない。
  onRestoreFileBrowserRoot: (listener: (path: string) => void): void => {
    ipcRenderer.once("app:fileBrowserRoot", (_event, path: string) => listener(path));
  },
};

contextBridge.exposeInMainWorld("tecscde", api);

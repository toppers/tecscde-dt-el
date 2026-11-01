// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: contextBridge.exposeInMainWorld による
// `window.tecscde` API の定義点。file・tecsgen・clipboardいずれもipcMain経由。

import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenResult,
  PdfPage,
  TecsgenResult,
  AppSettingsView,
  TecsgenVersionResult,
  GeneratedCdlResult,
  CppResult,
  TecscdeApi,
  DirEntry,
  ExportFormat,
  ImportRequest,
  ImportResolutionOptions,
  ResolvedImport,
  TecsgenOptionsFile,
  LogAppendResult,
} from "../shared/ipc-types.js";

const api: TecscdeApi = {
  // 外部仕様3.8: バージョン情報ダイアログ用。値を渡すだけで、操作の経路は持たない。
  versions: {
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node,
    platform: process.platform,
  },
  cdl: {
    loadGrammarAssets: () => ipcRenderer.invoke("cdl:grammar-assets"),
  },
  file: {
    save: (path: string, content: string): Promise<void> => ipcRenderer.invoke("file:save", path, content),
    saveAs: (content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:saveAs", content, suggestedName),
    export: (path: string, data: string | Uint8Array): Promise<void> => ipcRenderer.invoke("file:export", path, data),
    exportPdf: (path: string, svg: string, page: PdfPage): Promise<void> =>
      ipcRenderer.invoke("file:exportPdf", path, svg, page),
    chooseExportPath: (format: ExportFormat, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:chooseExportPath", format, suggestedName),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("file:chooseFolder"),
    listDirectory: (dirPath: string): Promise<readonly DirEntry[]> => ipcRenderer.invoke("file:listDirectory", dirPath),
    openPath: (path: string): Promise<OpenResult> => ipcRenderer.invoke("file:openPath", path),
    confirmDiscardChanges: (): Promise<boolean> => ipcRenderer.invoke("file:confirmDiscardChanges"),
    saveSession: (
      editablePath: string | null,
      referencePaths: readonly string[],
      extraImportPaths?: readonly string[],
      optionsFilePath?: string,
    ): Promise<void> =>
      optionsFilePath !== undefined
        ? ipcRenderer.invoke("file:saveSession", editablePath, referencePaths, extraImportPaths, optionsFilePath)
        : extraImportPaths !== undefined
          ? ipcRenderer.invoke("file:saveSession", editablePath, referencePaths, extraImportPaths)
          : ipcRenderer.invoke("file:saveSession", editablePath, referencePaths),
    resolveImports: (
      editablePath: string,
      requests: readonly ImportRequest[],
      options: ImportResolutionOptions,
    ): Promise<readonly ResolvedImport[]> => ipcRenderer.invoke("file:resolveImports", editablePath, requests, options),
    parseTecsgenOptionsFile: (path: string): Promise<TecsgenOptionsFile> =>
      ipcRenderer.invoke("file:parseTecsgenOptionsFile", path),
  },
  tecsgen: {
    generate: (args: readonly string[], cwd?: string): Promise<TecsgenResult> =>
      cwd !== undefined ? ipcRenderer.invoke("tecsgen:generate", args, cwd) : ipcRenderer.invoke("tecsgen:generate", args),
    generatedTypes: (args: readonly string[], editingFilePath: string, optionsFilePath?: string): Promise<GeneratedCdlResult> =>
      ipcRenderer.invoke("tecsgen:generatedTypes", args, editingFilePath, optionsFilePath),
    preprocess: (headerPath: string, cppCommand?: string, includeDirs?: readonly string[]): Promise<CppResult> =>
      ipcRenderer.invoke("tecsgen:preprocess", headerPath, cppCommand, includeDirs),
    version: (): Promise<TecsgenVersionResult> => ipcRenderer.invoke("tecsgen:version"),
  },
  // 実機確認で判明: preloadに公開される`electron`モジュールにはclipboardが
  // 含まれない（ESM/CJS問わず）ため、file/tecsgenと同様にipcMain経由にする。
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
    readText: (): Promise<string> => ipcRenderer.invoke("clipboard:readText"),
  },
  settings: {
    get: (): Promise<AppSettingsView> => ipcRenderer.invoke("settings:get"),
  },
  window: {
    setDirty: (dirty: boolean): void => ipcRenderer.send("window:setDirty", dirty),
  },
  log: {
    append: (lines: readonly string[]): Promise<LogAppendResult> => ipcRenderer.invoke("log:append", lines),
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

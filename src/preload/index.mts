// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: contextBridge.exposeInMainWorld による
// `window.tecscde` API の定義点。file・tecsgen・clipboardいずれもipcMain経由。

import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenResult,
  TecsgenResult,
  AppSettingsView,
  TecsgenVersionResult,
  GeneratedCdlResult,
  CppResult,
  TecscdeApi,
  DirEntry,
  ImportRequest,
  ImportResolutionOptions,
  ResolvedImport,
  TecsgenOptionsFile,
  SessionSnapshot,
  CloseStateResponse,
  SourceWriteReceipt,
  LogAppendResult,
} from "../shared/ipc-types.js";

const api: TecscdeApi = {
  cdl: {
    loadGrammarAssets: () => ipcRenderer.invoke("cdl:grammar-assets"),
  },
  file: {
    readDefinitionFile: (path) => ipcRenderer.invoke("file:readDefinitionFile", path),
    planCdlFileLists: (root) => ipcRenderer.invoke("file:planCdlFileLists", root),
    applyCdlFileLists: (planId) => ipcRenderer.invoke("file:applyCdlFileLists", planId),
    confirmCdlFileLists: (paths) => ipcRenderer.invoke("file:confirmCdlFileLists", paths),
    save: (path: string, content: string): Promise<void | SourceWriteReceipt> => ipcRenderer.invoke("file:save", path, content),
    chooseSavePath: (suggestedName: string): Promise<string | null> => ipcRenderer.invoke("file:chooseSavePath", suggestedName),
    saveAs: (content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke("file:saveAs", content, suggestedName),
    export: (path: string, data: string): Promise<void> => ipcRenderer.invoke("file:export", path, data),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("file:chooseFolder"),
    listDirectory: (dirPath: string): Promise<readonly DirEntry[]> => ipcRenderer.invoke("file:listDirectory", dirPath),
    openPath: (path: string): Promise<OpenResult> => ipcRenderer.invoke("file:openPath", path),
    openPaths: (paths: readonly string[]): Promise<OpenResult> => ipcRenderer.invoke("file:openPaths", paths),
    confirmDiscardChanges: (): Promise<boolean> => ipcRenderer.invoke("file:confirmDiscardChanges"),
    saveSession: (
      editablePath: string | null | SessionSnapshot,
      referencePaths?: readonly string[],
      extraImportPaths?: readonly string[],
      optionsFilePath?: string,
    ): Promise<void> =>
      typeof editablePath === "object" && editablePath !== null
        ? ipcRenderer.invoke("file:saveSession", editablePath)
        : optionsFilePath !== undefined
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
    checkPath: (path: string): Promise<TecsgenVersionResult> => ipcRenderer.invoke("tecsgen:checkPath", path),
    commandLine: (args, shell, cwd) => ipcRenderer.invoke("tecsgen:commandLine", args, shell, cwd),
  },
  // 実機確認で判明: preloadに公開される`electron`モジュールにはclipboardが
  // 含まれない（ESM/CJS問わず）ため、file/tecsgenと同様にipcMain経由にする。
  clipboard: {
    writeText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
    readText: (): Promise<string> => ipcRenderer.invoke("clipboard:readText"),
  },
  settings: {
    get: (): Promise<AppSettingsView> => ipcRenderer.invoke("settings:get"),
    getToolSettings: () => ipcRenderer.invoke("settings:getToolSettings"),
    updateToolSettings: (patch) => ipcRenderer.invoke("settings:updateToolSettings", patch),
    chooseTecsgenPath: () => ipcRenderer.invoke("settings:chooseTecsgenPath"),
    getAppInformation: () => ipcRenderer.invoke("settings:getAppInformation"),
    getCdlFilesRoot: () => ipcRenderer.invoke("settings:getCdlFilesRoot"),
    setCdlFilesRoot: (root) => ipcRenderer.invoke("settings:setCdlFilesRoot", root),
    chooseCdlFilesRoot: () => ipcRenderer.invoke("settings:chooseCdlFilesRoot"),
  },
  window: {
    setDirty: (dirty: boolean): void => ipcRenderer.send("window:setDirty", dirty),
    onRequestCloseState: (listener) => {
      const handler = (_event: unknown, request: { queryId: string }): void => listener(request.queryId);
      ipcRenderer.on("window:requestCloseState", handler);
      return () => ipcRenderer.removeListener("window:requestCloseState", handler);
    },
    onCancelCloseState: (listener) => {
      const handler = (_event: unknown, request: { queryId: string }): void => listener(request.queryId);
      ipcRenderer.on("window:cancelCloseState", handler);
      return () => ipcRenderer.removeListener("window:cancelCloseState", handler);
    },
    replyCloseState: (response: CloseStateResponse) => ipcRenderer.send("window:closeState", response),
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

// [[TECSCDE-DT-EL内部仕様]] 第7章7.2節・第9章9.2節: ipcMain.handle の登録一式。
// FileService/TecsgenRunner をIPC越しに公開する薄い配線層。

import { app, clipboard, ipcMain as electronIpcMain, dialog, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileService } from "./file-service.js";
import type { TecsgenRunner } from "./tecsgen-runner.js";
import type { LogService } from "./log-service.js";
import { loadAppSettings, saveAppSettings } from "./app-settings.js";
import { ToolSettingsService } from "./tool-settings.js";
import { getAppInformation } from "./app-information.js";
import { formatTecsgenCommand } from "./tecsgen-command-copy.js";
import { CdlFileListService } from "./cdl-file-list.js";
import type { ExportFormat, ImportRequest, ImportResolutionOptions, PdfPage, SessionSnapshot } from "../shared/ipc-types.js";

/**
 * macOSでは全ウィンドウを閉じてもアプリは終了せず、Dockから再度開くと`createWindow()`が
 * 再び呼ばれ、この関数も2回目が呼ばれる。`ipcMain.handle`は同じチャネルの二重登録で
 * 例外を投げるため、登録前に既存ハンドラを外す。以前のウィンドウは閉じ済みなので、
 * 最新ウィンドウの`FileService`等で置き換えるのが正しい動作。
 */
const ipcMain = {
  handle: (channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]): void => {
    electronIpcMain.removeHandler(channel);
    electronIpcMain.handle(channel, listener);
  },
};

export function registerIpcHandlers(
  fileService: FileService,
  tecsgenRunner: TecsgenRunner,
  logService: LogService,
  toolSettings: ToolSettingsService = new ToolSettingsService(),
  window?: BrowserWindow,
): void {
  const cdlLists = new CdlFileListService();
  // rendererからfile:// URLをfetchせず、mainがasar透過のfsでWASMを読む。
  // CDL文法とcdecl文法（9B章9B.3）は同じ起動シーケンスで一度に渡す。
  ipcMain.handle("cdl:grammar-assets", async () => {
    const wasmDir = join(app.getAppPath(), "public", "wasm");
    const [runtimeWasm, cdlWasm, cdeclWasm] = await Promise.all([
      readFile(join(wasmDir, "tree-sitter.wasm")),
      readFile(join(wasmDir, "tree-sitter-cdl.wasm")),
      readFile(join(wasmDir, "tree-sitter-tecs_cdecl.wasm")),
    ]);
    return { runtimeWasm, cdlWasm, cdeclWasm };
  });
  ipcMain.handle("file:save", (_e, path: string, content: string) => fileService.saveWithReceipt(path, content));
  ipcMain.handle("file:chooseSavePath", (_e, name: string) => fileService.chooseSavePath(name));
  ipcMain.handle("file:saveAs", (_e, content: string, suggestedName: string) =>
    fileService.saveAsDialog(suggestedName, content),
  );
  ipcMain.handle("file:export", (_e, path: string, data: string | Uint8Array) => fileService.exportFile(path, data));
  ipcMain.handle("file:exportPdf", (_e, path: string, svg: string, page: PdfPage) =>
    fileService.exportPdf(path, svg, page));
  ipcMain.handle("file:chooseExportPath", (_e, format: ExportFormat, suggestedName: string) =>
    fileService.chooseExportPath(format, suggestedName));
  // 第7章7.6.2節: ファイルブラウザ（2026-09-21採用、TECSCDE-DT外部仕様3.5.1節）。
  ipcMain.handle("file:chooseFolder", () => fileService.chooseFolder());
  ipcMain.handle("file:listDirectory", (_e, dirPath: string) => fileService.listDirectory(dirPath));
  ipcMain.handle("file:openPath", (_e, path: string) => fileService.openPath(path));
  ipcMain.handle("file:readDefinitionFile", async (_e, path: string) => (await fileService.openPath(path)).editable);
  ipcMain.handle("file:planCdlFileLists", (_e, root: string) => cdlLists.plan(root));
  ipcMain.handle("file:applyCdlFileLists", (_e, planId: string) => cdlLists.apply(planId));
  ipcMain.handle("file:confirmCdlFileLists", async (_e, paths: readonly string[]) => {
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) throw new Error("確認対象が不正です。");
    const detail = paths.slice(0, 10).join("\n") + (paths.length > 10 ? `\nほか ${paths.length - 10} 件` : "");
    const options = { type: "warning" as const, buttons: ["置き換える", "キャンセル"], defaultId: 1, cancelId: 1,
      message: "既存の一覧を上書きしますか？", detail };
    return (window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)).response === 0;
  });
  ipcMain.handle("file:openPaths", (_e, paths: readonly string[]) => fileService.openPaths(paths));
  // 第7B章7.6.4節: 未保存確認（2026-09-22追加、TECSCDE-DT外部仕様5.7節）。
  ipcMain.handle("file:confirmDiscardChanges", () => fileService.confirmDiscardChanges());
  // 第7C章7.7.1節: 前回セッションの永続化（2026-09-22追加）。ウィンドウに紐づかない
  // アプリケーション設定のため、FileServiceを経由せず直接saveAppSettingsを呼ぶ。
  ipcMain.handle(
    "file:saveSession",
    (_e, editablePath: string | null | SessionSnapshot, referencePaths: readonly string[] = [], extraImportPaths?: readonly string[], optionsFilePath?: string) =>
      saveAppSettings({
        lastSession: typeof editablePath === "object" && editablePath !== null ? editablePath : {
          ...(editablePath ? { editablePath } : {}),
          referencePaths,
          ...(extraImportPaths && extraImportPaths.length > 0 ? { extraImportPaths } : {}),
          ...(optionsFilePath ? { optionsFilePath } : {}),
        },
      }),
  );
  // 第7D章7.5.2節: import/import_C文の参照先解決（2026-09-22追加）。
  ipcMain.handle(
    "file:resolveImports",
    (_e, editablePath: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
      fileService.resolveImports(editablePath, requests, options),
  );
  // 第7C章7.7.4節（#10）: tecsgenオプション形式ファイルの解析（2026-09-22追加）。
  ipcMain.handle("file:parseTecsgenOptionsFile", (_e, path: string) => fileService.parseTecsgenOptionsFile(path));

  ipcMain.handle("tecsgen:generate", (_e, args: readonly string[], cwd?: string) => tecsgenRunner.generate(args, cwd));
  ipcMain.handle("tecsgen:generatedTypes", (_e, args: readonly string[], editingFilePath: string, optionsFilePath?: string) =>
    tecsgenRunner.generatedTypes(args, editingFilePath, optionsFilePath),
  );
  ipcMain.handle("tecsgen:preprocess", (_e, headerPath: string, cppCommand?: string, includeDirs?: readonly string[]) =>
    tecsgenRunner.preprocess(headerPath, cppCommand, includeDirs),
  );
  ipcMain.handle("tecsgen:version", () => tecsgenRunner.version());
  ipcMain.handle("tecsgen:checkPath", (_event, path: string) => toolSettings.checkPath(path));
  ipcMain.handle("tecsgen:commandLine", async (_event, args: unknown, shell: unknown, cwd: unknown) => {
    if (!Array.isArray(args) || !args.every((value) => typeof value === "string") ||
        (shell !== "powershell7" && shell !== "powershell5" && shell !== "cmd") ||
        (cwd !== undefined && typeof cwd !== "string")) throw new Error("コピーするコマンドの指定が不正です。");
    const command = await toolSettings.resolveCommand();
    return formatTecsgenCommand(command, args, shell, cwd ?? process.cwd());
  });
  ipcMain.handle("settings:getToolSettings", () => toolSettings.get());
  ipcMain.handle("settings:updateToolSettings", (_event, patch: { tecsgenPath: string }) => toolSettings.update(patch));
  ipcMain.handle("settings:getAppInformation", () => getAppInformation());
  ipcMain.handle("settings:getCdlFilesRoot", async () => (await loadAppSettings()).cdlFilesRoot ?? "");
  ipcMain.handle("settings:setCdlFilesRoot", (_e, root: unknown) => {
    if (typeof root !== "string") throw new Error("対象ディレクトリが不正です。");
    return saveAppSettings({ cdlFilesRoot: root });
  });
  ipcMain.handle("settings:chooseCdlFilesRoot", async () => {
    const options = { title: "CDL一覧の対象フォルダ", properties: ["openDirectory" as const] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("settings:chooseTecsgenPath", async () => {
    const options = { title: "tecsgenの実行ファイルを選択", properties: ["openFile" as const] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  // 第3章3.2節: rendererが読む設定（現状は`allowEditSystemDefined`のみ）。
  ipcMain.handle("settings:get", async () => ({
    allowEditSystemDefined: (await loadAppSettings()).allowEditSystemDefined === true,
  }));
  ipcMain.handle("log:append", (_e, lines: readonly string[]) => logService.append(lines));

  // 第4章4.1節・第2章2.4節: clipboardはpreloadから直接requireできない
  // （実機確認で判明——ESM/CJS問わずpreloadに公開されるelectronモジュールには
  // clipboardが含まれない。当初の想定は誤りだった）ため、mainプロセス経由にする。
  ipcMain.handle("clipboard:writeText", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("clipboard:readText", () => clipboard.readText());
}

// [[TECSCDE-DT-EL内部仕様]] 第7章7.2節・第9章9.2節: ipcMain.handle の登録一式。
// FileService/TecsgenRunner をIPC越しに公開する薄い配線層。

import { app, clipboard, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileService } from "./file-service.js";
import type { TecsgenRunner } from "./tecsgen-runner.js";
import { saveAppSettings } from "./app-settings.js";
import type { ImportRequest, ImportResolutionOptions } from "../shared/ipc-types.js";

export function registerIpcHandlers(fileService: FileService, tecsgenRunner: TecsgenRunner): void {
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
  ipcMain.handle("file:save", (_e, path: string, content: string) => fileService.save(path, content));
  ipcMain.handle("file:saveAs", (_e, content: string, suggestedName: string) =>
    fileService.saveAsDialog(suggestedName, content),
  );
  ipcMain.handle("file:export", (_e, path: string, data: string) => fileService.exportFile(path, data));
  // 第7章7.6.2節: ファイルブラウザ（2026-09-21採用、TECSCDE-DT外部仕様3.5.1節）。
  ipcMain.handle("file:chooseFolder", () => fileService.chooseFolder());
  ipcMain.handle("file:listDirectory", (_e, dirPath: string) => fileService.listDirectory(dirPath));
  ipcMain.handle("file:openPath", (_e, path: string) => fileService.openPath(path));
  // 第7B章7.6.4節: 未保存確認（2026-09-22追加、TECSCDE-DT外部仕様5.7節）。
  ipcMain.handle("file:confirmDiscardChanges", () => fileService.confirmDiscardChanges());
  // 第7C章7.7.1節: 前回セッションの永続化（2026-09-22追加）。ウィンドウに紐づかない
  // アプリケーション設定のため、FileServiceを経由せず直接saveAppSettingsを呼ぶ。
  ipcMain.handle("file:saveSession", (_e, editablePath: string | null, referencePaths: readonly string[]) =>
    saveAppSettings({ lastSession: editablePath ? { editablePath, referencePaths } : { referencePaths } }),
  );
  // 第7D章7.5.2節: import/import_C文の参照先解決（2026-09-22追加）。
  ipcMain.handle(
    "file:resolveImports",
    (_e, editablePath: string, requests: readonly ImportRequest[], options: ImportResolutionOptions) =>
      fileService.resolveImports(editablePath, requests, options),
  );
  // 第7C章7.7.4節（#10）: tecsgenオプション形式ファイルの解析（2026-09-22追加）。
  ipcMain.handle("file:parseTecsgenOptionsFile", (_e, path: string) => fileService.parseTecsgenOptionsFile(path));

  ipcMain.handle("tecsgen:generate", (_e, args: readonly string[]) => tecsgenRunner.run(args));
  ipcMain.handle("tecsgen:preprocess", (_e, headerPath: string, cppCommand?: string) =>
    tecsgenRunner.preprocess(headerPath, cppCommand),
  );
  ipcMain.handle("tecsgen:version", () => tecsgenRunner.version());

  // 第4章4.1節・第2章2.4節: clipboardはpreloadから直接requireできない
  // （実機確認で判明——ESM/CJS問わずpreloadに公開されるelectronモジュールには
  // clipboardが含まれない。当初の想定は誤りだった）ため、mainプロセス経由にする。
  ipcMain.handle("clipboard:writeText", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("clipboard:readText", () => clipboard.readText());
}

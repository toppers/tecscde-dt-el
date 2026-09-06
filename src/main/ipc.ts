// [[TECSCDE-DT-EL内部仕様]] 第7章7.2節・第9章9.2節: ipcMain.handle の登録一式。
// FileService/TecsgenRunner をIPC越しに公開する薄い配線層。

import { ipcMain } from "electron";
import type { FileService } from "./file-service.js";
import type { TecsgenRunner } from "./tecsgen-runner.js";

export function registerIpcHandlers(fileService: FileService, tecsgenRunner: TecsgenRunner): void {
  ipcMain.handle("file:open", () => fileService.openDialog());
  ipcMain.handle("file:save", (_e, path: string, content: string) => fileService.save(path, content));
  ipcMain.handle("file:saveAs", (_e, content: string, suggestedName: string) =>
    fileService.saveAsDialog(suggestedName, content),
  );
  ipcMain.handle("file:export", (_e, path: string, data: string) => fileService.exportFile(path, data));

  ipcMain.handle("tecsgen:generate", (_e, args: readonly string[]) => tecsgenRunner.run(args));
  ipcMain.handle("tecsgen:version", () => tecsgenRunner.version());
}

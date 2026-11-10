// 第3章3.2節: アプリケーション設定（`settings.json`のうちrendererが読むもの）への薄いラッパ。
// プロセス境界はこのクラスの内部に閉じ込める（第2章2.4節）。

import type { AppSettingsView, ToolSettings, ToolSettingsUpdateResult, AppInformation } from "../../shared/ipc-types.js";

export class SettingsGateway {
  get(): Promise<AppSettingsView> {
    return window.tecscde.settings.get();
  }

  getToolSettings(): Promise<ToolSettings> { return window.tecscde.settings.getToolSettings(); }
  updateToolSettings(patch: { readonly tecsgenPath: string }): Promise<ToolSettingsUpdateResult> {
    return window.tecscde.settings.updateToolSettings(patch);
  }
  chooseTecsgenPath(): Promise<string | null> { return window.tecscde.settings.chooseTecsgenPath(); }
  getAppInformation(): Promise<AppInformation> { return window.tecscde.settings.getAppInformation(); }
  getCdlFilesRoot(): Promise<string> { return window.tecscde.settings.getCdlFilesRoot(); }
  setCdlFilesRoot(root: string): Promise<void> { return window.tecscde.settings.setCdlFilesRoot(root); }
  chooseCdlFilesRoot(): Promise<string | null> { return window.tecscde.settings.chooseCdlFilesRoot(); }
}

// 第3章3.2節: アプリケーション設定（`settings.json`のうちrendererが読むもの）への薄いラッパ。
// プロセス境界はこのクラスの内部に閉じ込める（第2章2.4節）。

import type { AppSettingsView } from "../../shared/ipc-types.js";

export class SettingsGateway {
  get(): Promise<AppSettingsView> {
    return window.tecscde.settings.get();
  }
}

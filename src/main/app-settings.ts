// [[TECSCDE-DT-EL内部仕様]] 第7B章「ファイルブラウザ設計」7.6.6節: ファイルブラウザの
// ルートフォルダなど、ウィンドウ非依存のアプリケーション設定を永続化する。
// FileService（1ウィンドウに紐づくダイアログ操作）とは別の関心事のため独立させる。

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface AppSettings {
  readonly fileBrowserRoot?: string;
  /**
   * 第7C章7.7.1節: 前回終了時に開いていたファイル集合。`editablePath`は「消去」（7.7.3節）後は
   * 無し——未保存の新規作成はパスを持たないためセッション復元の対象外。references集合は
   * `editablePath`の有無に関わらず維持する。
   */
  readonly lastSession?: {
    readonly editablePath?: string;
    readonly referencePaths: readonly string[];
  };
}

/**
 * 2026-09-22訂正: `app.getPath('userData')`（Windowsでは`%APPDATA%`＝Roaming）は
 * ドメイン環境でローミングプロファイルが有効だと複数PC間で同期されうる。ファイルブラウザの
 * ルートフォルダは各PC固有のローカルパスを指すため、ローミングされると別PCでは無効なパスが
 * 復元されてしまう——PC固有の設定は明示的にLocal AppData配下へ置く。Windows以外に
 * Roaming/Localの区別は無いため、Windows以外では`userData`のままでよい。
 */
function settingsDir(): string {
  if (process.platform === "win32" && process.env["LOCALAPPDATA"]) {
    return join(process.env["LOCALAPPDATA"], "tecscde-dt-el");
  }
  return app.getPath("userData");
}

function settingsPath(): string {
  return join(settingsDir(), "settings.json");
}

/** 初回起動・壊れた設定ファイルはいずれも「設定なし」として扱う（エラーにしない）。 */
export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), "utf-8");
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

/**
 * 設定ファイルはCDEファイルと異なり壊れても実害が「記憶が1件失われる」程度に留まるため、
 * 第7章7.1節の`writeAtomic`のような一時ファイル＋リネームは要求しない。
 * `app.getPath('userData')`と異なりLocal AppData配下の`tecscde-dt-el/`ディレクトリは
 * Electronが自動生成しないため、書き込み前に`mkdir`する。
 *
 * 2026-09-22訂正: `lastSession`（第7C章7.7.1節）の追加に伴い、呼び出し元ごとに異なる
 * キー（`fileBrowserRoot`／`lastSession`）を都度保存する（7.6.6節・7.7.1節いずれも
 * 「変化するたび保存」方針）ため、現在値を読み込んでマージしてから書き込む
 * ——そのまま丸ごと上書きすると、片方の保存で他方のキーが消える。
 */
export async function saveAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await loadAppSettings();
  const dir = settingsDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "settings.json"), JSON.stringify({ ...current, ...patch }));
}

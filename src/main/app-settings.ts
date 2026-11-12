// [[TECSCDE-DT-EL内部仕様]] 第7B章「ファイルブラウザ設計」7.6.6節: ファイルブラウザの
// ルートフォルダなど、ウィンドウ非依存のアプリケーション設定を永続化する。
// FileService（1ウィンドウに紐づくダイアログ操作）とは別の関心事のため独立させる。

import { promises as fs } from "node:fs";
import { join, posix, win32 } from "node:path";
import { app } from "electron";
import type { SessionSnapshot } from "../shared/ipc-types.js";

export interface AppSettings {
  readonly [key: string]: unknown;
  readonly fileBrowserRoot?: string;
  /**
   * 第3章3.2節: `true`なら、システム定義CDL（`-S`のディレクトリ配下）のセルも通常のCDLと同じく
   * 編集可能にする。既定は`false`（閲覧のみ）。現状は`settings.json`を直接編集して設定する。
   */
  readonly allowEditSystemDefined?: boolean;
  /**
   * 第7H章: 前回の主・追加CDLと解析順。`editablePath: null`の主なし・空セッションも
   * 有効であり、未保存本文は復元せず、保存済み参照をその役割のまま復元する。
   */
  readonly lastSession?: SessionSnapshot;
}

/** Legacy session fields are accepted at the update boundary and normalized before writing. */
export type AppSettingsPatch = Omit<Partial<AppSettings>, "lastSession"> & {
  readonly lastSession?: Partial<SessionSnapshot>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isWindowsPath = (path: string): boolean => /^[a-z]:|^[/\\]{2}/i.test(path);
// I/O values must retain their UNC host/share prefix. Comparison-only path helpers
// intentionally used by renderer filters are unsuitable as persisted file paths.
const normalizeFilePath = (path: string): string => isWindowsPath(path) ? win32.normalize(path) : posix.normalize(path);
const pathKey = (path: string): string => {
  const normalized = normalizeFilePath(path);
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized;
};
const isAbsoluteFilePath = (path: string): boolean => path.length > 0 && (posix.isAbsolute(path) || win32.isAbsolute(path));
const stringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** 7H.1: An explicitly malformed source order invalidates the session instead of guessing. */
export function normalizeSessionSnapshot(value: unknown): SessionSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value.editablePath !== undefined && value.editablePath !== null && typeof value.editablePath !== "string") return undefined;
  if (value.referencePaths !== undefined && !stringArray(value.referencePaths)) return undefined;
  if (value.extraImportPaths !== undefined && !stringArray(value.extraImportPaths)) return undefined;
  if (value.optionsFilePath !== undefined && typeof value.optionsFilePath !== "string") return undefined;
  if (value.sourceOrder !== undefined && !stringArray(value.sourceOrder)) return undefined;
  if (typeof value.editablePath === "string" && !isAbsoluteFilePath(value.editablePath)) return undefined;
  if (typeof value.optionsFilePath === "string" && !isAbsoluteFilePath(value.optionsFilePath)) return undefined;
  if (((value.referencePaths ?? []) as readonly string[]).some((path) => !isAbsoluteFilePath(path))) return undefined;
  if (((value.sourceOrder ?? []) as readonly string[]).some((path) => !isAbsoluteFilePath(path))) return undefined;
  const editablePath = typeof value.editablePath === "string" ? normalizeFilePath(value.editablePath) : null;
  const seen = new Set<string>(editablePath === null ? [] : [pathKey(editablePath)]);
  const referencePaths: string[] = [];
  for (const path of (value.referencePaths ?? []) as readonly string[]) {
    const normalized = normalizeFilePath(path);
    const key = pathKey(normalized);
    if (!seen.has(key)) {
      referencePaths.push(normalized);
      seen.add(key);
    }
  }
  let sourceOrder = [...referencePaths, ...(editablePath === null ? [] : [editablePath])];
  if (value.sourceOrder !== undefined) {
    sourceOrder = (value.sourceOrder as readonly string[]).map(normalizeFilePath);
    const keys = sourceOrder.map(pathKey);
    if (keys.length !== seen.size || new Set(keys).size !== keys.length || keys.some((key) => !seen.has(key))) return undefined;
    const referenceOrder = keys.filter((key) => editablePath === null || key !== pathKey(editablePath));
    if (referenceOrder.some((key, index) => key !== pathKey(referencePaths[index]!))) return undefined;
  }
  return {
    editablePath,
    referencePaths,
    extraImportPaths: [...((value.extraImportPaths ?? []) as readonly string[])],
    ...(typeof value.optionsFilePath === "string" ? { optionsFilePath: normalizeFilePath(value.optionsFilePath) } : {}),
    sourceOrder,
  };
}

/** Unknown keys survive normalization; invalid known fields cannot reach consumers. */
export function normalizeAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return {};
  const normalized = { ...value };
  for (const key of ["fileBrowserRoot", "tecsgenPath", "cdlFilesRoot"]) {
    if (normalized[key] !== undefined && typeof normalized[key] !== "string") delete normalized[key];
  }
  if (typeof normalized.allowEditSystemDefined !== "boolean") delete normalized.allowEditSystemDefined;
  if (normalized.lastSession !== undefined) {
    const session = normalizeSessionSnapshot(normalized.lastSession);
    if (session) normalized.lastSession = session;
    else delete normalized.lastSession;
  }
  return normalized as AppSettings;
}

/**
 * 2026-09-22訂正: `app.getPath('userData')`（Windowsでは`%APPDATA%`＝Roaming）は
 * ドメイン環境でローミングプロファイルが有効だと複数PC間で同期されうる。ファイルブラウザの
 * ルートフォルダは各PC固有のローカルパスを指すため、ローミングされると別PCでは無効なパスが
 * 復元されてしまう——PC固有の設定は明示的にLocal AppData配下へ置く。Windows以外に
 * Roaming/Localの区別は無いため、Windows以外では`userData`のままでよい。
 */
export function settingsDir(): string {
  if (process.platform === "win32" && process.env["LOCALAPPDATA"]) {
    return join(process.env["LOCALAPPDATA"], "tecscde-dt-el");
  }
  return app.getPath("userData");
}

/** 外部仕様9.5.2の規定2: 診断ログは、設定ファイルと同じフォルダの `logs/` に置く。 */
export function logsDirectory(): string {
  return join(settingsDir(), "logs");
}

function settingsPath(): string {
  return join(settingsDir(), "settings.json");
}

/** 初回起動・壊れた設定ファイルはいずれも「設定なし」として扱う（エラーにしない）。 */
async function readAppSettings(path: string): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(path, "utf-8");
    return normalizeAppSettings(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

let settingsQueue: Promise<unknown> = Promise.resolve();

function enqueueSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsQueue.then(operation);
  settingsQueue = result.catch(() => {});
  return result;
}

export function loadAppSettings(): Promise<AppSettings> {
  const path = settingsPath();
  return enqueueSettingsOperation(() => readAppSettings(path));
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
export function saveAppSettings(patch: AppSettingsPatch): Promise<void> {
  const dir = settingsDir();
  // Freeze the caller's snapshot before it enters the queue.
  const snapshot = structuredClone(patch);
  return enqueueSettingsOperation(async () => {
    const path = join(dir, "settings.json");
    const current = await readAppSettings(path);
    const next = normalizeAppSettings({ ...current, ...snapshot });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, JSON.stringify(next));
  });
}

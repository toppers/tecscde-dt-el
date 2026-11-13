// 09D.2-5: one serialized main-process owner for the active execution settings.
// 09E: V0.2.1 C preprocessor settings and command resolution.
import { constants, existsSync, readdirSync, statSync, accessSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { loadAppSettings, saveAppSettings, type AppSettings, type AppSettingsPatch } from "./app-settings.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { resolveTecsgenCommand, snapshotTecsgenEnvironment, type TecsgenDiscoveryOptions } from "./tecsgen-path-resolver.js";
import type {
  CppOrigin,
  CppOriginReason,
  PluginTypeSource,
  ResolvedTecsgenCommand,
  ToolSettings,
  ToolSettingsUpdate,
  ToolSettingsUpdateResult,
  TecsgenVersionResult,
} from "../shared/ipc-types.js";

export interface DetectedExecutable {
  readonly name: string;
  readonly fullPath: string;
}

export interface ResolvedCppCommand {
  readonly command: string;
  readonly executable: string;
  readonly fullPath: string;
  readonly origin: CppOrigin;
  readonly originReason: CppOriginReason;
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === "win32") {
      const lastDot = filePath.lastIndexOf(".");
      const ext = lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : "";
      const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean)
        .map((e) => e.toLowerCase());
      return extensions.includes(ext);
    } else {
      accessSync(filePath, constants.X_OK);
      return true;
    }
  } catch {
    return false;
  }
}

export function findGccOnPath(
  envPath = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): DetectedExecutable | null {
  const dirs = envPath.split(platform === "win32" ? ";" : ":").filter((p) => p.length > 0);
  const extensions = platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.toLowerCase())
    : [""];

  // 1. 完全一致の gcc / gcc.exe を先に探す
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `gcc${ext}`);
      if (isExecutableFile(candidate, platform)) {
        return { name: "gcc", fullPath: candidate };
      }
    }
  }

  // 2. 拡張子除き末尾が gcc の実行ファイル（例: arm-none-eabi-gcc.exe）
  const GCC_STEM_REGEX = /^.*gcc$/i;
  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lastDot = entry.name.lastIndexOf(".");
        const stem = lastDot >= 0 ? entry.name.slice(0, lastDot) : entry.name;
        const ext = lastDot >= 0 ? entry.name.slice(lastDot).toLowerCase() : "";
        if (platform === "win32" && !extensions.includes(ext)) {
          continue;
        }
        if (GCC_STEM_REGEX.test(stem)) {
          const fullPath = join(dir, entry.name);
          if (isExecutableFile(fullPath, platform)) {
            return { name: entry.name, fullPath };
          }
        }
      }
    } catch {
      // ディレクトリ読み取り不可はスキップ
    }
  }
  return null;
}

export function findOnPath(
  executable: string,
  envPath = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (isAbsolute(executable)) {
    try {
      const stat = statSync(executable);
      return stat.isFile() ? executable : null;
    } catch {
      return null;
    }
  }
  const dirs = envPath.split(platform === "win32" ? ";" : ":").filter((p) => p.length > 0);
  const extensions = platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.toLowerCase())
    : [""];

  for (const dir of dirs) {
    if (platform === "win32") {
      const lastDot = executable.lastIndexOf(".");
      const hasExt = lastDot >= 0;
      if (hasExt) {
        const candidate = join(dir, executable);
        if (isExecutableFile(candidate, platform)) return candidate;
      } else {
        for (const ext of extensions) {
          const candidate = join(dir, `${executable}${ext}`);
          if (isExecutableFile(candidate, platform)) return candidate;
        }
      }
    } else {
      const candidate = join(dir, executable);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

export function resolveCppCommand(
  cdlCppCommand: string | undefined,
  savedSettings: { cppPath?: string; cppArgs?: string },
  envPath = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): ResolvedCppCommand {
  // 1. CDL 固有指定
  if (cdlCppCommand && cdlCppCommand.trim().length > 0) {
    const trimmed = cdlCppCommand.trim();
    let exe = trimmed.split(/\s+/)[0] ?? "";
    if (trimmed.startsWith('"')) {
      const match = /^"([^"]*)"/.exec(trimmed);
      if (match && match[1] !== undefined) {
        exe = match[1];
      }
    }
    const resolvedPath = isAbsolute(exe) ? exe : (findOnPath(exe, envPath, platform) ?? exe);
    return {
      command: trimmed,
      executable: exe,
      fullPath: resolvedPath,
      origin: "cdl",
      originReason: "ユーザ直接指定",
    };
  }

  const args = savedSettings.cppArgs?.trim();
  const buildCommand = (executable: string) => {
    const quotedExe =
      /\s/.test(executable) && !executable.startsWith('"')
        ? `"${executable}"`
        : executable;
    return args && args.length > 0 ? `${quotedExe} ${args}` : quotedExe;
  };

  // 2. 明示設定 (settings.json)
  if (savedSettings.cppPath && savedSettings.cppPath.trim().length > 0) {
    const exe = savedSettings.cppPath.trim();
    const resolvedPath = isAbsolute(exe) ? exe : (findOnPath(exe, envPath, platform) ?? exe);
    return {
      command: buildCommand(exe),
      executable: exe,
      fullPath: resolvedPath,
      origin: "settings",
      originReason: "ユーザ直接指定",
    };
  }

  // 3. PATH上の自動検出
  const detected = findGccOnPath(envPath, platform);
  if (detected) {
    return {
      command: buildCommand(detected.name),
      executable: detected.name,
      fullPath: detected.fullPath,
      origin: "path",
      originReason: "自動検出",
    };
  }

  // 4. フォールバック
  const fallbackFound = findOnPath("gcc", envPath, platform);
  return {
    command: buildCommand("gcc"),
    executable: "gcc",
    fullPath: fallbackFound ?? "未検出 (PATH上)",
    origin: "default",
    originReason: "フォールバック",
  };
}

export async function chooseCppPath(currentPath?: string, window?: BrowserWindow): Promise<string | null> {
  const defaultDir = currentPath && existsSync(currentPath)
    ? (statSync(currentPath).isDirectory() ? currentPath : dirname(currentPath))
    : undefined;

  const options: Electron.OpenDialogOptions = {
    title: "C プリプロセッサ実行ファイルの選択",
    defaultPath: defaultDir,
    filters: process.platform === "win32"
      ? [
          { name: "実行可能ファイル (*.exe;*.cmd;*.bat)", extensions: ["exe", "cmd", "bat"] },
          { name: "すべてのファイル (*.*)", extensions: ["*"] },
        ]
      : [{ name: "すべてのファイル (*)", extensions: ["*"] }],
    properties: ["openFile"],
  };

  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
}

export interface ToolSettingsServiceOptions extends TecsgenDiscoveryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly load?: () => Promise<AppSettings>;
  readonly save?: (patch: AppSettingsPatch) => Promise<void>;
}

export class ToolSettingsService {
  private readonly environment: Readonly<NodeJS.ProcessEnv>;
  private readonly load: () => Promise<AppSettings>;
  private readonly save: (patch: AppSettingsPatch) => Promise<void>;
  private readonly discovery: TecsgenDiscoveryOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private current: ToolSettings | undefined;
  private revision = 0;

  constructor(options: ToolSettingsServiceOptions = {}) {
    this.environment = snapshotTecsgenEnvironment(options.env ?? process.env, options.platform ?? process.platform);
    this.load = options.load ?? loadAppSettings;
    this.save = options.save ?? saveAppSettings;
    this.discovery = {
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.pathCandidates ? { pathCandidates: [...options.pathCandidates] } : {}),
      ...(options.exists ? { exists: options.exists } : {}),
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private settings(
    path: string,
    command: ResolvedTecsgenCommand,
    resolvedCpp: ResolvedCppCommand,
    cppPath: string,
    cppArgs?: string,
    pluginTypeSource: PluginTypeSource = "external",
  ): ToolSettings {
    return Object.freeze({
      revision: this.revision,
      tecsgenPath: path,
      tecspath: this.environment.TECSPATH ?? "",
      effectiveSource: command.source,
      effectiveCommand: this.environment.TECSGEN_COMMAND !== undefined
        ? this.environment.TECSGEN_COMMAND : command.executable,
      executable: command.executable,
      prefixArgs: Object.freeze([...command.args]),
      override: this.environment.TECSGEN_COMMAND !== undefined,
      cppPath,
      cppArgs,
      effectiveCppCommand: resolvedCpp.command,
      effectiveCppFullPath: resolvedCpp.fullPath,
      cppOrigin: resolvedCpp.origin,
      cppOriginReason: resolvedCpp.originReason,
      pluginTypeSource,
    });
  }

  private async initialize(): Promise<void> {
    if (this.current) return;
    const stored = await this.load();
    let path = typeof stored.tecsgenPath === "string" ? stored.tecsgenPath : "";
    const command = await resolveTecsgenCommand(this.environment, path, this.discovery);
    if (path === "" && (command.source === "tecspath" || command.source === "path")) {
      path = command.executable;
      await this.save({ tecsgenPath: path });
    }
    const cppPath = typeof stored.cppPath === "string" ? stored.cppPath : "";
    const cppArgs = typeof stored.cppArgs === "string" ? stored.cppArgs : undefined;
    const resolvedCpp = resolveCppCommand(
      undefined,
      { cppPath, cppArgs },
      this.environment.PATH ?? "",
      this.discovery.platform ?? process.platform,
    );
    const pluginTypeSource: PluginTypeSource = stored.pluginTypeSource ?? "external";
    this.current = this.settings(path, command, resolvedCpp, cppPath, cppArgs, pluginTypeSource);
  }

  get(): Promise<ToolSettings> {
    return this.enqueue(async () => { await this.initialize(); return this.current!; });
  }

  async resolveCommand(): Promise<ResolvedTecsgenCommand> {
    const settings = await this.get();
    return { executable: settings.executable, args: [...settings.prefixArgs], source: settings.effectiveSource, revision: settings.revision };
  }

  async resolveForPreprocess(cdlCppCommand?: string): Promise<ResolvedCppCommand> {
    const current = await this.get();
    return resolveCppCommand(
      cdlCppCommand,
      { cppPath: current.cppPath, cppArgs: current.cppArgs },
      this.environment.PATH ?? "",
      this.discovery.platform ?? process.platform,
    );
  }

  update(patch: ToolSettingsUpdate): Promise<ToolSettingsUpdateResult> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return Promise.resolve({ ok: false, error: "設定の指定が不正です。" });
    }
    const allowedKeys = ["tecsgenPath", "cppPath", "cppArgs", "pluginTypeSource"];
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0 || patchKeys.some((key) => !allowedKeys.includes(key))) {
      return Promise.resolve({ ok: false, error: "指定された設定キーまたは値が不正です。" });
    }
    for (const key of patchKeys) {
      if (key === "pluginTypeSource") {
        const val = patch.pluginTypeSource;
        if (val !== "external" && val !== "internal") {
          return Promise.resolve({ ok: false, error: "pluginTypeSourceには'external'または'internal'を指定してください。" });
        }
      } else if (typeof (patch as Record<string, unknown>)[key] !== "string") {
        return Promise.resolve({ ok: false, error: `${key}には文字列を指定してください。` });
      }
    }

    return this.enqueue(async () => {
      try {
        await this.initialize();
        const stored = await this.load();

        let pathInput = patch.tecsgenPath !== undefined
          ? patch.tecsgenPath
          : (typeof stored.tecsgenPath === "string" ? stored.tecsgenPath : "");

        const command = await resolveTecsgenCommand(this.environment, pathInput, this.discovery);
        const path = pathInput === "" && (command.source === "tecspath" || command.source === "path")
          ? command.executable : pathInput;

        const newCppPath = patch.cppPath !== undefined
          ? patch.cppPath
          : (typeof stored.cppPath === "string" ? stored.cppPath : "");
        const newCppArgs = patch.cppArgs !== undefined
          ? patch.cppArgs
          : (typeof stored.cppArgs === "string" ? stored.cppArgs : undefined);

        const newPluginTypeSource: PluginTypeSource = patch.pluginTypeSource !== undefined
          ? patch.pluginTypeSource
          : (stored.pluginTypeSource ?? "external");

        const patchToSave: AppSettingsPatch = {
          ...(patch.tecsgenPath !== undefined ? { tecsgenPath: path } : {}),
          ...(patch.cppPath !== undefined ? { cppPath: patch.cppPath } : {}),
          ...(patch.cppArgs !== undefined ? { cppArgs: patch.cppArgs } : {}),
          ...(patch.pluginTypeSource !== undefined ? { pluginTypeSource: patch.pluginTypeSource } : {}),
        };

        await this.save(patchToSave);
        this.revision++;

        const resolvedCpp = resolveCppCommand(
          undefined,
          { cppPath: newCppPath, cppArgs: newCppArgs },
          this.environment.PATH ?? "",
          this.discovery.platform ?? process.platform,
        );

        this.current = this.settings(path, command, resolvedCpp, newCppPath, newCppArgs, newPluginTypeSource);
        return { ok: true, settings: this.current };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  checkPath(path: string): Promise<TecsgenVersionResult> {
    if (typeof path !== "string") return Promise.resolve({ kind: "failed", detail: "候補パスが文字列ではありません。" });
    return new TecsgenRunner(async () => ({ executable: path, args: [], source: "settings" })).version();
  }
}

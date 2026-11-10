// 09D.2-5: one serialized main-process owner for the active execution settings.
import { loadAppSettings, saveAppSettings, type AppSettings, type AppSettingsPatch } from "./app-settings.js";
import { TecsgenRunner } from "./tecsgen-runner.js";
import { resolveTecsgenCommand, snapshotTecsgenEnvironment, type TecsgenDiscoveryOptions } from "./tecsgen-path-resolver.js";
import type { ResolvedTecsgenCommand, ToolSettings, ToolSettingsUpdateResult, TecsgenVersionResult } from "../shared/ipc-types.js";

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

  private settings(path: string, command: ResolvedTecsgenCommand): ToolSettings {
    return Object.freeze({ revision: this.revision, tecsgenPath: path,
      tecspath: this.environment.TECSPATH ?? "", effectiveSource: command.source,
      effectiveCommand: this.environment.TECSGEN_COMMAND !== undefined
        ? this.environment.TECSGEN_COMMAND : command.executable,
      executable: command.executable, prefixArgs: Object.freeze([...command.args]),
      override: this.environment.TECSGEN_COMMAND !== undefined });
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
    this.current = this.settings(path, command);
  }

  get(): Promise<ToolSettings> {
    return this.enqueue(async () => { await this.initialize(); return this.current!; });
  }

  async resolveCommand(): Promise<ResolvedTecsgenCommand> {
    const settings = await this.get();
    return { executable: settings.executable, args: [...settings.prefixArgs], source: settings.effectiveSource, revision: settings.revision };
  }

  update(patch: { readonly tecsgenPath: string }): Promise<ToolSettingsUpdateResult> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || typeof patch.tecsgenPath !== "string" ||
        Object.keys(patch).some((key) => key !== "tecsgenPath")) {
      return Promise.resolve({ ok: false, error: "tecsgenPathには文字列だけを指定してください。" });
    }
    const pathInput = patch.tecsgenPath;
    return this.enqueue(async () => {
      try {
        await this.initialize();
        const command = await resolveTecsgenCommand(this.environment, pathInput, this.discovery);
        const path = pathInput === "" && (command.source === "tecspath" || command.source === "path")
          ? command.executable : pathInput;
        // Resolve the empty input before the one write, so a failed auto-save
        // cannot leave persisted and active settings in different transactions.
        await this.save({ tecsgenPath: path });
        this.revision++;
        this.current = this.settings(path, command);
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

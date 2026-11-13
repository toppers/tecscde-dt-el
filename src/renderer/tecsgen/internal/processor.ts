// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 — InternalTecsgenProcessor。
// tecsgen を起動せず、ディスクへも書かずに、付表に載ったプラグインの CDL 生成物をメモリ上で作る。
// `fs` と外部プロセスに依存しない純粋な計算で、入出力は `VirtualFileSystem` だけにする（9D.6 の3）。

import type { CTypeRegistry } from "../../cdecl/type-registry";
import {
  CdlProgram, CdlProgramError,
  type CdlSourceProvider, type GenerateHandler, type GenerateRequest, type PluginInstance, type ResolvedSource,
} from "./cdl-program";
import { PluginError, type PluginHost } from "./mruby-bridge";
import { DEFAULT_PLUGIN_REGISTRY, type PluginRegistry } from "./plugin-registry";
import { MemoryFileSystem, VirtualFileLimitError, virtualPluginPath, type VirtualFileSystem } from "./virtual-file-system";

export interface InternalTecsgenInput {
  /** 開く CDL（tecsgen に渡す入力に当たる）。 */
  readonly main: ResolvedSource;
  /** `import` の解決。 */
  readonly provider: CdlSourceProvider;
  /** `import_C` のヘッダから集めた C の型（読み込み時に作ったもの）。 */
  readonly cTypes: CTypeRegistry;
}

export interface InternalTecsgenOptions {
  /** 使うプラグインを絞る（省略時は付表の全部）。 */
  readonly enabledPlugins?: readonly string[];
  readonly registry?: PluginRegistry;
}

export interface InternalDiagnostic {
  readonly code: "W-PLUGIN-UNSUPPORTED" | "W-PLUGIN-TYPE-LOAD";
  readonly message: string;
  readonly pluginName?: string;
}

export interface InternalTecsgenResult {
  /** 失敗したときは生成物を取り込まない（9D.6 の5）。 */
  readonly ok: boolean;
  readonly files: VirtualFileSystem;
  readonly diagnostics: readonly InternalDiagnostic[];
  readonly infos: readonly string[];
}

export class InternalTecsgenProcessor {
  static process(input: InternalTecsgenInput, options: InternalTecsgenOptions = {}): InternalTecsgenResult {
    return new Run(input, options).execute();
  }
}

class Run implements GenerateHandler, PluginHost {
  readonly files = new MemoryFileSystem();
  readonly cTypes: CTypeRegistry;
  readonly program: CdlProgram;
  private readonly diagnostics: InternalDiagnostic[] = [];
  private readonly infos: string[] = [];
  private readonly counters = new Map<string, number>();
  private readonly postCodes = new Map<string, () => string>();
  private readonly registry: PluginRegistry;
  private readonly enabled: ReadonlySet<string> | undefined;
  private readonly states = new Map<string, unknown>();

  constructor(private readonly input: InternalTecsgenInput, options: InternalTecsgenOptions) {
    this.cTypes = input.cTypes;
    this.registry = options.registry ?? DEFAULT_PLUGIN_REGISTRY;
    this.enabled = options.enabledPlugins ? new Set(options.enabledPlugins) : undefined;
    this.program = new CdlProgram(input.provider, this);
  }

  execute(): InternalTecsgenResult {
    try {
      this.program.importSource(this.input.main);
      // PluginModule.gen_plugin_post_code: 使われたプラグインのクラスごとに post code を書いて読む。
      this.program.markPostCoded();
      for (const [className, gen] of [...this.postCodes]) {
        this.writeAndParse(className, `tmp_${className}_post_code.cdl`, gen());
      }
      return { ok: true, files: this.files, diagnostics: this.diagnostics, infos: this.infos };
    } catch (error) {
      if (error instanceof PluginError || error instanceof CdlProgramError || error instanceof VirtualFileLimitError) {
        this.diagnostics.push({ code: "W-PLUGIN-TYPE-LOAD", message: `内部 tecsgen: ${error.message}` });
        return { ok: false, files: new MemoryFileSystem(), diagnostics: this.diagnostics, infos: this.infos };
      }
      throw error;
    }
  }

  /** プラグインごとの、実行中だけ残る状態（Ruby 版のクラス変数）。 */
  state<T>(key: string, create: () => T): T {
    if (!this.states.has(key)) this.states.set(key, create());
    return this.states.get(key) as T;
  }

  generate(request: GenerateRequest): void {
    const plugin = this.enabled && !this.enabled.has(request.pluginName) ? undefined : this.registry.get(request.pluginName);
    if (!plugin) {
      this.diagnostics.push({
        code: "W-PLUGIN-UNSUPPORTED", pluginName: request.pluginName,
        message: `プラグイン '${request.pluginName}' は内部処理の対象外です（生成型は取り込みません。開く処理は続行します。外部 tecsgen 方式に切り替えると取り込める可能性があります）`,
      });
      return;
    }
    plugin.apply(request, this);
  }

  generateAndParse(className: string, genCdlFile: () => string, owner: PluginInstance): void {
    const count = this.counters.get(className) ?? 0;
    this.counters.set(className, count + 1);
    const text = genCdlFile();
    const path = virtualPluginPath(className, `tmp_${className}_${count}.cdl`);
    this.files.write(path, text);
    this.program.parseGenerated(text, path, owner);
  }

  writeAndParse(className: string, fileName: string, text: string, owner?: PluginInstance): void {
    const path = virtualPluginPath(className, fileName);
    this.files.write(path, text);
    this.program.parseGenerated(text, path, owner);
  }

  registerPostCode(className: string, genPostCode: () => string): void {
    if (!this.postCodes.has(className)) this.postCodes.set(className, genPostCode);
  }

  info(message: string): void {
    this.infos.push(message);
  }
}

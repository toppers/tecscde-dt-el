// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 / 外部仕様 8.5
// PluginTypeProvider: 外部 tecsgen (ExternalPluginTypeProvider) および
// 内部 tecsgen (InternalPluginTypeProvider) の統一型プロバイダ。

import type { GeneratedCdlFile, PluginTypeSource } from "../../shared/ipc-types.js";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway.js";
import { TecsgenCommandBuilder } from "./command-builder.js";
import { describeLaunchFailure, describeTecsgenFailure } from "./failure-summary.js";
import type { CTypeRegistry, TypeDefinition } from "../cdecl/type-registry.js";
import type { CdeclResult } from "../cdecl/extractor.js";
import type { CdlGrammarAssets } from "../cdl/grammar.js";
import {
  handleInternalTecsgenWorkerRequest,
  type InternalTecsgenWorkerRequest,
  type InternalTecsgenWorkerResponse,
  type InternalTecsgenWorkerSource,
} from "./internal/worker.js";

export interface PluginTypeDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: "W-PLUGIN-UNSUPPORTED" | "W-PLUGIN-TYPE-LOAD" | string;
  readonly message: string;
  readonly pluginName?: string;
}

export interface PluginTypeResult {
  readonly ok: boolean;
  readonly source: PluginTypeSource;
  readonly files: readonly GeneratedCdlFile[];
  /** files と同等のエイリアス（既存の GeneratedCdlResult との互換性用） */
  readonly sources: readonly GeneratedCdlFile[];
  readonly diagnostics: readonly PluginTypeDiagnostic[];
  readonly infos?: readonly string[];
}

export interface PluginTypeRequest {
  /** 主入力（編集対象）。外部実行では editingFilePath としても使われる。 */
  readonly main: { readonly path: string; readonly text: string };
  /** 参照ソース群（ファイルパスと内容）。外部実行では referenceFilePaths としても使われる。 */
  readonly sources?: readonly { readonly path: string; readonly text: string }[];
  /** C 型情報（内部処理用）。 */
  readonly cTypes?: CTypeRegistry;
  /** cdecl 抽出結果（Worker 通信用）。 */
  readonly cdeclResults?: ReadonlyArray<[string, CdeclResult]> | ReadonlyMap<string, CdeclResult>;
  /** CDL 内 local typedefs（Worker 通信用）。 */
  readonly locals?: readonly TypeDefinition[];
  /** 有効なプラグイン名の絞り込み（内部処理用）。 */
  readonly enabledPlugins?: readonly string[];
  /** 外部 tecsgen に渡す引数（明示指定時）。未指定時は自動構築。 */
  readonly args?: readonly string[];
  /** .tecsgen-opts へのパス（外部実行用）。 */
  readonly optionsFilePath?: string;
  /** 追加インポート探索パス（外部引数自動構築用）。 */
  readonly importPaths?: readonly string[];
  /** マクロ定義（外部引数自動構築用）。 */
  readonly defineMacros?: readonly string[];
  /** C プリプロセッサ（外部引数自動構築用）。 */
  readonly cpp?: string;
  /** WASM 文法アセット（Worker 初期化用）。 */
  readonly grammarAssets?: Partial<CdlGrammarAssets>;
}

export interface PluginTypeProvider {
  readonly source: PluginTypeSource;
  generateTypes(request: PluginTypeRequest): Promise<PluginTypeResult>;
  generatedTypes?(request: PluginTypeRequest): Promise<PluginTypeResult>;
}

export interface WorkerLike {
  postMessage(message: any, transfer?: any[]): void;
  terminate(): void;
  onmessage?: ((ev: MessageEvent<any>) => any) | null;
  onerror?: ((ev: any) => any) | null;
}

/**
 * 外部 tecsgen 実行による PluginTypeProvider。
 * TecsgenGateway.generatedTypes を呼び出し、失敗しても内部処理へ自動フォールバックしない（9D.6 #7）。
 */
export class ExternalPluginTypeProvider implements PluginTypeProvider {
  readonly source: PluginTypeSource = "external";

  constructor(private readonly gateway: Pick<TecsgenGateway, "generatedTypes">) {}

  async generateTypes(request: PluginTypeRequest): Promise<PluginTypeResult> {
    const editingFilePath = request.main.path;
    const args = request.args ?? TecsgenCommandBuilder.buildArgs({
      importPath: request.importPaths,
      defineMacro: request.defineMacros,
      cpp: request.cpp,
      referenceFilePaths: (request.sources ?? []).map((s) => s.path),
      editingFilePath,
    });

    try {
      const generated = await this.gateway.generatedTypes(args, editingFilePath, request.optionsFilePath);
      const failure = generated.result.launchFailure ??
        (generated.result.executableFound ? undefined : { kind: "not-found" as const, command: "tecsgen", detail: "ENOENT" });
      if (failure) {
        return {
          ok: false,
          source: "external",
          files: [],
          sources: [],
          diagnostics: [{
            severity: "warning",
            code: "W-PLUGIN-TYPE-LOAD",
            message: describeLaunchFailure(failure),
          }],
          infos: [],
        };
      }
      if (generated.result.exitCode !== 0) {
        return {
          ok: false,
          source: "external",
          files: [],
          sources: [],
          diagnostics: [{
            severity: "warning",
            code: "W-PLUGIN-TYPE-LOAD",
            message: describeTecsgenFailure(generated.result),
          }],
          infos: [],
        };
      }
      return {
        ok: true,
        source: "external",
        files: generated.sources,
        sources: generated.sources,
        diagnostics: [],
        infos: [],
      };
    } catch (error) {
      return {
        ok: false,
        source: "external",
        files: [],
        sources: [],
        diagnostics: [{
          severity: "warning",
          code: "W-PLUGIN-TYPE-LOAD",
          message: `Plugin生成型を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
        }],
        infos: [],
      };
    }
  }

  async generatedTypes(request: PluginTypeRequest): Promise<PluginTypeResult> {
    return this.generateTypes(request);
  }
}

export interface InternalPluginTypeProviderOptions {
  readonly workerFactory?: () => WorkerLike;
  readonly workerUrl?: string | URL;
  readonly timeoutMs?: number;
  readonly enabledPlugins?: readonly string[];
}

/**
 * テストや非 Worker 環境で使えるインプロセス WorkerLike アダプタ。
 */
export class InProcessWorker implements WorkerLike {
  private terminated = false;
  onmessage: ((ev: MessageEvent<InternalTecsgenWorkerResponse>) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;

  constructor(
    private readonly handler: (
      req: InternalTecsgenWorkerRequest,
    ) => Promise<InternalTecsgenWorkerResponse> = handleInternalTecsgenWorkerRequest,
  ) {}

  postMessage(message: any): void {
    if (this.terminated) return;
    setTimeout(async () => {
      if (this.terminated) return;
      try {
        const response = await this.handler(message as InternalTecsgenWorkerRequest);
        if (this.terminated) return;
        this.onmessage?.({ data: response } as MessageEvent<InternalTecsgenWorkerResponse>);
      } catch (err) {
        if (this.terminated) return;
        this.onerror?.(err);
      }
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/**
 * 内部 tecsgen (InternalTecsgenProcessor) による PluginTypeProvider。
 * fs や外部プロセスに一切依存せず、Web Worker とメモリ内 VirtualFileSystem だけで
 * 生成型と診断を返す。
 * 30秒タイムアウト・失敗時の破棄・自動フォールバック禁止を徹底する（9D.6 #3, #5, #6, #7）。
 */
export class InternalPluginTypeProvider implements PluginTypeProvider {
  readonly source: PluginTypeSource = "internal";
  private readonly workerFactory: () => WorkerLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: InternalPluginTypeProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.workerFactory = options.workerFactory ?? (() => {
      if (typeof Worker !== "undefined") {
        try {
          const url = options.workerUrl ?? new URL("./tecsgen-worker.js", import.meta.url);
          return new Worker(url, { type: "module" });
        } catch {
          return new InProcessWorker();
        }
      }
      return new InProcessWorker();
    });
  }

  async generateTypes(request: PluginTypeRequest): Promise<PluginTypeResult> {
    const worker = this.workerFactory();
    const timeoutMs = this.timeoutMs;

    return new Promise<PluginTypeResult>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          worker.terminate();
        } catch {}
        resolve({
          ok: false,
          source: "internal",
          files: [],
          sources: [],
          diagnostics: [{
            severity: "warning",
            code: "W-PLUGIN-TYPE-LOAD",
            message: `内部 tecsgen 処理が制限時間（${timeoutMs}ms）内に終了せず、タイムアウトにより中断されました。`,
          }],
          infos: [],
        });
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {}
      };

      worker.onmessage = (event: MessageEvent<InternalTecsgenWorkerResponse>) => {
        if (settled) return;
        settled = true;
        cleanup();
        const data = event.data;
        if (!data || !data.ok) {
          resolve({
            ok: false,
            source: "internal",
            files: [],
            sources: [],
            diagnostics: (data?.diagnostics ?? []).map((d) => ({
              severity: "warning" as const,
              code: d.code,
              message: d.message,
              pluginName: d.pluginName,
            })),
            infos: data?.infos ?? [],
          });
          return;
        }

        const files: GeneratedCdlFile[] = (data.files ?? []).map((f) => ({
          fileName: f.fileName,
          content: f.content,
        }));

        resolve({
          ok: true,
          source: "internal",
          files,
          sources: files,
          diagnostics: (data.diagnostics ?? []).map((d) => ({
            severity: "warning" as const,
            code: d.code,
            message: d.message,
            pluginName: d.pluginName,
          })),
          infos: data.infos ?? [],
        });
      };

      worker.onerror = (error: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        const message = error instanceof Error ? error.message : (error?.message ? String(error.message) : "Worker error");
        resolve({
          ok: false,
          source: "internal",
          files: [],
          sources: [],
          diagnostics: [{
            severity: "warning",
            code: "W-PLUGIN-TYPE-LOAD",
            message: `内部 tecsgen Worker でエラーが発生しました: ${message}`,
          }],
          infos: [],
        });
      };

      try {
        const workerReq: InternalTecsgenWorkerRequest = {
          main: request.main,
          sources: request.sources,
          cTypes: request.cTypes,
          cdeclResults: request.cdeclResults instanceof Map ? [...request.cdeclResults.entries()] : request.cdeclResults,
          locals: request.locals,
          enabledPlugins: request.enabledPlugins ?? this.options.enabledPlugins,
          grammarAssets: request.grammarAssets,
        };
        worker.postMessage(workerReq);
      } catch (err) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ok: false,
          source: "internal",
          files: [],
          sources: [],
          diagnostics: [{
            severity: "warning",
            code: "W-PLUGIN-TYPE-LOAD",
            message: `Worker へのメッセージ送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          }],
          infos: [],
        });
      }
    });
  }

  async generatedTypes(request: PluginTypeRequest): Promise<PluginTypeResult> {
    return this.generateTypes(request);
  }
}

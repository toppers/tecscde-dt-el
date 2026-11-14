// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 — 内部 tecsgen Web Worker。
// UI スレッドの描画や操作をブロックしないよう、内部 tecsgen（InternalTecsgenProcessor）の実行を
// Web Worker 上で非同期に行う（9D.6 #3）。
// fs や外部プロセスには依存せず、メモリ内の仮想ファイルシステムのみで処理する。

import { CdlGrammar, type CdlGrammarAssets } from "../../cdl/grammar";
import { CTypeRegistry, type TypeDefinition } from "../../cdecl/type-registry";
import type { CdeclResult } from "../../cdecl/extractor";
import type { CdlSourceProvider, ResolvedSource } from "./cdl-program";
import { InternalTecsgenProcessor, type InternalDiagnostic } from "./processor";

export interface InternalTecsgenWorkerSource {
  readonly path: string;
  readonly text: string;
}

export interface InternalTecsgenWorkerRequest {
  readonly main: InternalTecsgenWorkerSource;
  readonly sources?: readonly InternalTecsgenWorkerSource[];
  readonly cTypes?: CTypeRegistry;
  readonly cdeclResults?: ReadonlyArray<[string, CdeclResult]> | ReadonlyMap<string, CdeclResult>;
  readonly locals?: readonly TypeDefinition[];
  readonly enabledPlugins?: readonly string[];
  readonly grammarAssets?: Partial<CdlGrammarAssets>;
}

export interface InternalTecsgenWorkerFile {
  readonly fileName: string;
  readonly content: string;
}

export interface InternalTecsgenWorkerResponse {
  readonly ok: boolean;
  readonly files: readonly InternalTecsgenWorkerFile[];
  readonly diagnostics: readonly InternalDiagnostic[];
  readonly infos: readonly string[];
}

export class MemorySourceProvider implements CdlSourceProvider {
  private readonly files = new Map<string, string>();

  constructor(sources: readonly InternalTecsgenWorkerSource[]) {
    for (const src of sources) {
      this.files.set(src.path, src.text);
      this.files.set(src.path.replace(/\\/g, "/"), src.text);
    }
  }

  resolveImport(spec: string, _isSystem?: boolean, fromPath?: string): ResolvedSource | undefined {
    const normalized = spec.replace(/\\/g, "/");

    // 相対パス探索
    if (fromPath) {
      const fromDir = fromPath.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
      const relCandidate = `${fromDir}/${normalized}`;
      if (this.files.has(relCandidate)) {
        return { path: relCandidate, text: this.files.get(relCandidate)! };
      }
    }

    // 完全一致探索
    if (this.files.has(normalized)) {
      return { path: normalized, text: this.files.get(normalized)! };
    }
    if (this.files.has(spec)) {
      return { path: spec, text: this.files.get(spec)! };
    }

    // 末尾一致探索
    for (const [key, text] of this.files) {
      if (key.endsWith("/" + normalized) || key.endsWith("\\" + spec)) {
        return { path: key, text };
      }
    }

    // ファイル名一致探索
    const specBase = normalized.split("/").pop();
    if (specBase) {
      for (const [key, text] of this.files) {
        if (key.split("/").pop() === specBase) {
          return { path: key, text };
        }
      }
    }

    // システム定義 <mruby.cdl> の組み込みフォールバック（内部 tecsgen でディスクや外部 tecsgen 不要にするため）
    if (spec === "mruby.cdl" || normalized === "mruby.cdl" || specBase === "mruby.cdl") {
      return {
        path: "mruby.cdl",
        text: "signature sInitializeTECSBridge { void initializeBridge([in] const char_t *VMname); };\n",
      };
    }

    return undefined;
  }
}

export async function handleInternalTecsgenWorkerRequest(
  req: InternalTecsgenWorkerRequest,
): Promise<InternalTecsgenWorkerResponse> {
  try {
    if (!CdlGrammar.isReady) {
      await CdlGrammar.init(req.grammarAssets);
    }

    const sources = req.sources ?? [];
    const provider = new MemorySourceProvider(sources);

    let cTypes: CTypeRegistry;
    if (req.cTypes instanceof CTypeRegistry) {
      cTypes = req.cTypes;
    } else {
      const resultsMap = new Map<string, CdeclResult>();
      if (req.cdeclResults) {
        const entries = req.cdeclResults instanceof Map ? req.cdeclResults.entries() : req.cdeclResults;
        for (const [path, r] of entries) {
          const typedefs = r.typedefs instanceof Map ? r.typedefs : new Map(Array.isArray(r.typedefs) ? r.typedefs : Object.entries(r.typedefs ?? {}));
          const structs = r.structs instanceof Map ? r.structs : new Map(Array.isArray(r.structs) ? r.structs : Object.entries(r.structs ?? {}));
          resultsMap.set(path, {
            typedefs,
            structs,
            usedFallback: r.usedFallback ?? false,
            hasErrors: r.hasErrors ?? false,
          });
        }
      }
      cTypes = new CTypeRegistry(resultsMap, req.locals ?? []);
    }

    const result = InternalTecsgenProcessor.process(
      {
        main: req.main,
        provider,
        cTypes,
      },
      req.enabledPlugins ? { enabledPlugins: req.enabledPlugins } : {},
    );

    const files = result.ok
      ? result.files.list().map((path) => ({
          fileName: path,
          content: result.files.read(path) ?? "",
        }))
      : [];

    return {
      ok: result.ok,
      files,
      diagnostics: result.diagnostics,
      infos: result.infos,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      files: [],
      diagnostics: [{ code: "W-PLUGIN-TYPE-LOAD", message }],
      infos: [],
    };
  }
}

// Web Worker スレッドでロードされた場合のエントリポイントリスナー
if (typeof self !== "undefined" && typeof (self as any).postMessage === "function" && typeof (self as any).document === "undefined") {
  self.onmessage = async (event: MessageEvent<InternalTecsgenWorkerRequest>) => {
    const response = await handleInternalTecsgenWorkerRequest(event.data);
    self.postMessage(response);
  };
}

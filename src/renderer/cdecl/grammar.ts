// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] 9B.3 —
// tree-sitter-tecs-cdecl文法のロードと初期化（CdeclGrammar）。
//
// ../cdl/grammar.ts の CdlGrammar と完全に同じ形（内部仕様2.2/2.4節が定めるプロセス
// 配置・非同期境界の閉じ込め方針をそのまま適用する——モジュールBはCDL用・cdecl用の
// 2文法とも同一プロセス（renderer）に置き、追加のIPC設計を増やさない、第11章11.2節#5）。
//
// WASM資産はrendererからの直接fetchではなく、mainがfsで読みIPC経由でバイト列を渡す
// 方式を使う（../cdl/grammar.ts 冒頭コメント、第11章11.5節#7と同じ理由）。

import { Language, Parser } from "web-tree-sitter";

/** .wasm の在り処。ブラウザは既定のURL、テスト（Node）は実体を注入する。 */
export interface CdeclGrammarAssets {
  /** web-tree-sitter 自身のランタイム wasm。emscripten の locateFile に渡す。 */
  readonly runtimeWasm: string | Uint8Array;
  /** tecs-cdecl文法（C_parser.y.rb 由来）。URL文字列またはバイト列。 */
  readonly cdeclWasm: string | Uint8Array;
}

const BROWSER_DEFAULTS: CdeclGrammarAssets = {
  runtimeWasm: "/wasm/tree-sitter.wasm",
  cdeclWasm: "/wasm/tree-sitter-tecs_cdecl.wasm",
};

export class CdeclGrammar {
  private static parser: Parser | undefined;
  private static initPromise: Promise<void> | undefined;

  private constructor() {}

  /**
   * cdeclパーサを初期化する。アプリ起動時に1度だけ呼ぶ。
   * 多重呼び出しは同じPromiseを返すため、呼び出し側で排他する必要はない。
   */
  static init(assets?: Partial<CdeclGrammarAssets>): Promise<void> {
    CdeclGrammar.initPromise ??= (async () => {
      const resolved: CdeclGrammarAssets = { ...BROWSER_DEFAULTS, ...assets };
      await Parser.init(
        typeof resolved.runtimeWasm === "string"
          ? { locateFile: () => resolved.runtimeWasm as string }
          : { wasmBinary: resolved.runtimeWasm },
      );
      const language = await Language.load(resolved.cdeclWasm);
      const parser = new Parser();
      parser.setLanguage(language);
      CdeclGrammar.parser = parser;
    })();
    return CdeclGrammar.initPromise;
  }

  /** 初期化済みか。 */
  static get isReady(): boolean {
    return CdeclGrammar.parser !== undefined;
  }

  /**
   * 初期化済みパーサを返す。未初期化なら投げる——import_Cの解決を始める前に
   * CdeclGrammar.init() の解決を待っていない、起動シーケンスの不具合。
   */
  static get parserInstance(): Parser {
    if (!CdeclGrammar.parser) {
      throw new Error(
        "cdeclパーサが未初期化です。import_Cの解決を行う前に CdeclGrammar.init() の解決を待ってください（9B章9B.3）。",
      );
    }
    return CdeclGrammar.parser;
  }

  /** テスト用。初期化状態を捨てて次の init() をやり直せるようにする。 */
  static resetForTest(): void {
    CdeclGrammar.parser = undefined;
    CdeclGrammar.initPromise = undefined;
  }
}

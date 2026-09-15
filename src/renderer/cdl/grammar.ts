// TECSCDE-TS内部仕様 2.2/2.4 — tree-sitter文法のロードと初期化（CdlGrammar）。
//
// 構文解析は tecsgen 自身の構文定義からの移植文法に委ねる（外部仕様2.2が唯一の
// 外部依存として認めるCDL解析系）。本クラスはその文法をロードし、初期化済みの
// パーサを保持するだけの薄い層である。
//
// 非同期なのはWASMのロードだけで、ロード後の parse() は同期。したがって
// 非同期性は init() の1点に閉じ込め、CdlDocumentBuilder 以降の契約は同期に保つ。
//
// 文法パッケージ同梱の lib/index.ts は使わない——`__dirname` に依存しており
// ブラウザで動かないため。必要なのは .wasm だけなので public/wasm/ へ取り込み、
// ここで直接ロードする（経緯は public/wasm/README.md、2.4節）。

import { Language, Parser } from "web-tree-sitter";

/** .wasm の在り処。ブラウザは既定のURL、テスト（Node）は実体を注入する。 */
export interface CdlGrammarAssets {
  /** web-tree-sitter 自身のランタイム wasm。emscripten の locateFile に渡す。 */
  readonly runtimeWasm: string | Uint8Array;
  /** CDL文法（bnf.y.rb 由来）。URL文字列またはバイト列。 */
  readonly cdlWasm: string | Uint8Array;
}

const BROWSER_DEFAULTS: CdlGrammarAssets = {
  runtimeWasm: "/wasm/tree-sitter.wasm",
  cdlWasm: "/wasm/tree-sitter-cdl.wasm",
};

export class CdlGrammar {
  private static parser: Parser | undefined;
  private static initPromise: Promise<void> | undefined;

  private constructor() {}

  /**
   * CDLパーサを初期化する。アプリ起動時に1度だけ呼ぶ。
   * 多重呼び出しは同じPromiseを返すため、呼び出し側で排他する必要はない。
   */
  static init(assets?: Partial<CdlGrammarAssets>): Promise<void> {
    CdlGrammar.initPromise ??= (async () => {
      const resolved: CdlGrammarAssets = { ...BROWSER_DEFAULTS, ...assets };
      await Parser.init(
        typeof resolved.runtimeWasm === "string"
          ? { locateFile: () => resolved.runtimeWasm as string }
          : { wasmBinary: resolved.runtimeWasm },
      );
      const language = await Language.load(resolved.cdlWasm);
      const parser = new Parser();
      parser.setLanguage(language);
      CdlGrammar.parser = parser;
    })();
    return CdlGrammar.initPromise;
  }

  /** 初期化済みか。 */
  static get isReady(): boolean {
    return CdlGrammar.parser !== undefined;
  }

  /**
   * 初期化済みパーサを返す。未初期化なら投げる——これは利用者入力に由来する
   * エラーではなく起動シーケンスの不具合なので、診断へ倒さず即座に失敗させる
   * （CDLを解析できないアプリは図を1つも開けない）。
   */
  static get parserInstance(): Parser {
    if (!CdlGrammar.parser) {
      throw new Error(
        "CDLパーサが未初期化です。解析を行う前に CdlGrammar.init() の解決を待ってください（内部仕様2.2）。",
      );
    }
    return CdlGrammar.parser;
  }

  /** テスト用。初期化状態を捨てて次の init() をやり直せるようにする。 */
  static resetForTest(): void {
    CdlGrammar.parser = undefined;
    CdlGrammar.initPromise = undefined;
  }
}

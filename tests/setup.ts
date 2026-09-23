// TECSCDE-TS内部仕様 2.2 — テスト環境でのCDLパーサ初期化。
//
// ブラウザでは public/wasm/ 配下を URL として fetch するが、テスト（Node）は
// URL 解決ができない。CdlGrammar.init() の注入口を使い、ランタイムwasmはパスで、
// 文法wasmはバイト列で渡す。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll } from "vitest";
import { CdlGrammar } from "../src/renderer/cdl/grammar";
import { CdeclGrammar } from "../src/renderer/cdecl/grammar";

const wasmDir = resolve(__dirname, "../public/wasm");

beforeAll(async () => {
  // web-tree-sitterのParser.init()はEmscriptenランタイムをグローバルに初期化するため、
  // CdlGrammar/CdeclGrammarの2つのinit()を並列（Promise.all）で走らせると初期化処理が
  // 競合し、後段のLanguage.loadが「Incompatible language version 0」で失敗する
  // （実測、2026-09-23）。順番に完了を待つ（逐次awaitのみで十分——処理時間への影響は
  // 小さい）。
  await CdlGrammar.init({
    runtimeWasm: resolve(wasmDir, "tree-sitter.wasm"),
    cdlWasm: new Uint8Array(readFileSync(resolve(wasmDir, "tree-sitter-cdl.wasm"))),
  });
  // 9B章9B.3: cdeclパーサもテスト全体の前に一度だけ初期化する。
  await CdeclGrammar.init({
    runtimeWasm: resolve(wasmDir, "tree-sitter.wasm"),
    cdeclWasm: new Uint8Array(readFileSync(resolve(wasmDir, "tree-sitter-tecs_cdecl.wasm"))),
  });
});

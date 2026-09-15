// TECSCDE-TS内部仕様 2.2 — テスト環境でのCDLパーサ初期化。
//
// ブラウザでは public/wasm/ 配下を URL として fetch するが、テスト（Node）は
// URL 解決ができない。CdlGrammar.init() の注入口を使い、ランタイムwasmはパスで、
// 文法wasmはバイト列で渡す。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll } from "vitest";
import { CdlGrammar } from "../src/renderer/cdl/grammar";

const wasmDir = resolve(__dirname, "../public/wasm");

beforeAll(async () => {
  await CdlGrammar.init({
    runtimeWasm: resolve(wasmDir, "tree-sitter.wasm"),
    cdlWasm: new Uint8Array(readFileSync(resolve(wasmDir, "tree-sitter-cdl.wasm"))),
  });
});

import { defineConfig } from "vitest/config";

// 内部仕様2.2: CDLパーサ（WASM文法）の初期化は非同期なので、
// 解析を行う全テストの前に一度だけ待つ。
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});

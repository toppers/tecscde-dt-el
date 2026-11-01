import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { appInfoDefine } from "./scripts/app-info.mjs";

// 内部仕様2.2: CDLパーサ（WASM文法）の初期化は非同期なので、
// 解析を行う全テストの前に一度だけ待つ。
export default defineConfig({
  // 外部仕様2.5.5: ビルド（scripts/build-renderer.mjs）と同じ定義を渡す。
  define: appInfoDefine(fileURLToPath(new URL(".", import.meta.url))),
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});

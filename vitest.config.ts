import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
import { appInfoDefine } from "./scripts/app-info.mjs";

// 内部仕様2.2: CDLパーサ（WASM文法）の初期化は非同期なので、
// 解析を行う全テストの前に一度だけ待つ。
export default defineConfig({
  define: { __TECSCDE_APP_VERSION__: JSON.stringify(process.env.TECSCDE_TEST_APP_VERSION ?? version), ...appInfoDefine(fileURLToPath(new URL(".", import.meta.url))) },
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});

// アプリケーションの版（外部仕様2.5.5）。唯一の情報源は package.json の version。
// renderer のビルド（esbuild の define）と vitest（define）の両方が、ここから同じ値を得る。
// コミットの短縮ハッシュは、Git の作業ツリーでなければ（配布物の展開先など）"unknown"。

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readAppInfo(root) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
  let commit = "unknown";
  try {
    const hash = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (/^[0-9a-f]{7,}$/.test(hash)) commit = hash;
  } catch {
    // Git が無い、または作業ツリーではない
  }
  return { version: String(pkg.version), commit };
}

/** esbuild と vitest の `define` に渡す。値は JSON 文字列として埋め込まれる。 */
export function appInfoDefine(root) {
  const { version, commit } = readAppInfo(root);
  return {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  };
}

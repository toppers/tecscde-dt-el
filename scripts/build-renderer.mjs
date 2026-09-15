// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」/ [[TECSCDE-実装アーキテクチャ案]] 7項:
// renderer を単一 JS バンドル + 単一 HTML として出力する。esbuild はビルド時限定の
// devDependency であり、配布物のランタイム依存ゼロ（外部仕様2.2）とは矛盾しない。
//
//   node scripts/build-renderer.mjs           一度だけビルド
//   node scripts/build-renderer.mjs --watch   変更を監視して再ビルド

import { build, context } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist/renderer");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(root, "src/renderer/main.ts")],
  outfile: resolve(outDir, "renderer.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  // web-tree-sitter contains Node-only dynamic imports behind runtime guards.
  // Keep them external; Electron renderer takes the browser branch.
  external: ["fs/promises", "module"],
  logLevel: "info",
};

async function copyStaticAssets() {
  await mkdir(outDir, { recursive: true });
  await cp(resolve(root, "src/renderer/index.html"), resolve(outDir, "index.html"));
  // packaged build 用に samples も dist へ（dev の main は public/samples を直接読む）。
  await cp(resolve(root, "public/samples"), resolve(outDir, "samples"), { recursive: true });
  await cp(resolve(root, "public/wasm"), resolve(outDir, "wasm"), { recursive: true });
}

if (watch) {
  await copyStaticAssets();
  const ctx = await context(options);
  await ctx.watch();
  console.log("[build-renderer] watching…");
} else {
  await copyStaticAssets();
  await build(options);
  console.log("[build-renderer] done →", outDir);
}

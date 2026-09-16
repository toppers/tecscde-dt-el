// TECSCDE-DT-EL内部仕様 第11章11.2節#2（配布・自動更新・コード署名の実現手段）の
// うち「配布ツールの選定」を解消する: Electron Forgeでパッケージング(package/make)を行う。
// 自動更新(publish)・コード署名・macOS/Linux向けMakerは範囲外（別タスク）。
//
// 既存の開発フロー（npm start = build + electron .）には影響しない。
// package/make の前に、既存の tsc + esbuild ビルド（npm run build）をそのまま再利用する。

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [{ name: "@electron-forge/maker-squirrel", config: {} }],
  hooks: {
    async prePackage() {
      // execSync は常にシェル経由で単一コマンド文字列を実行するため、
      // Windows の npm.cmd を直接spawnする際のEINVALも、execFileSync+shell:trueの
      // DEP0190警告（引数配列の未エスケープ）も両方避けられる。引数はハードコード
      // のみで外部入力を含まないためコマンドインジェクションのリスクはない。
      execSync("npm run build", { stdio: "inherit", cwd: root });
    },
  },
};

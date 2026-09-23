// TECSCDE-DT-EL内部仕様 第11章11.2節#2（配布・自動更新・コード署名の実現手段）の
// うち「配布ツールの選定」を解消する: Electron Forgeでパッケージング(package/make)を行う。
// コード署名・macOS/Linux向けMakerは範囲外（別タスク）。
//
// 自動更新(publish)は [[work/active/tecs/TECSCDE-DT-EL 配布アーキテクチャ決定]]（2026-09-23）の
// 決定に従い、origin自身（toppers/tecscde-dt-el、public）へ直接publishする。
// GitHub Actions（.github/workflows/release.yml）が `v*` タグpushをトリガーに
// `electron-forge publish` を実行し、update-electron-app（src/main/index.ts）が
// update.electronjs.org経由でここに公開されたリリースを自動更新元として使う。
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
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "toppers",
          name: "tecscde-dt-el",
        },
        // CIが作るリリースはいったんdraftに留め、update.electronjs.org経由で
        // ユーザーに配信される前に人間の最終確認を挟む（自動パイプラインが壊れた
        // 成果物をそのまま配信してしまうリスクを避けるための安全側の選択）。
        draft: true,
        authToken: process.env.GITHUB_TOKEN,
      },
    },
  ],
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

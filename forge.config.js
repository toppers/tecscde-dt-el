// TECSCDE-DT-EL内部仕様 第11章11.2節#2（配布・自動更新・コード署名の実現手段）の
// うち「配布ツールの選定」を解消する: Electron Forgeでパッケージング(package/make)を行う。
// コード署名は範囲外（当面は未署名で配布する、2026-09-23決定）。
// macOS（DMG＋ZIP）・Linux（DEB＋RPM）のMakerは内部仕様11Bの決定に従って登録してあるが、
// Windows以外ではビルドも起動も未検証（2026-10-28時点。release.yml の各OSジョブで初めて走る）。
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
  // 既定は ./out。同じ場所のファイルがロックされて package が EBUSY で失敗するときに
  // 備え、環境変数 FORGE_OUT_DIR で出力先を別の場所へ逃がせるようにしている。
  ...(process.env.FORGE_OUT_DIR ? { outDir: process.env.FORGE_OUT_DIR } : {}),
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    // Windows: Squirrel（Setup.exe / RELEASES / .nupkg）。自動更新の元。
    { name: "@electron-forge/maker-squirrel", platforms: ["win32"], config: {} },
    // macOS: DMGは初回インストール用、ZIPは自動更新用（Forgeが自動更新にZIPの併用を案内している）。
    // 署名・公証は未設定（未署名配布）。アーキテクチャは実行したrunnerのもの（arm64のmacos-latest）。
    { name: "@electron-forge/maker-dmg", platforms: ["darwin"], config: {} },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
    // Linux: DEBとRPM。Linux向けの自動更新は未対応（update-electron-app は macOS・Windows のみ）。
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: { options: { categories: ["Development"] } },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: { options: { categories: ["Development"] } },
    },
  ],
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

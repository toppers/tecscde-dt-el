// 外部仕様2.5.5: アプリケーションの版の唯一の情報源は package.json の version。
// ビルド時に esbuild の define で埋め込まれる（scripts/app-info.mjs）。ここ以外に版の値を書かない。

/** アプリケーションの版（package.json の version）。 */
export const APP_VERSION: string = __APP_VERSION__;

/** ビルドしたコミットの短縮ハッシュ。取得できなかったときは "unknown"。 */
export const APP_COMMIT: string = __APP_COMMIT__;

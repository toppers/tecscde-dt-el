// electron-winstaller@5.4.4 の script/select-7z-arch.js は `os.arch`（呼び出し忘れ、
// 関数参照のまま文字列結合）を使っており vendor/7z.exe・vendor/7z.dll を生成できない。
// 生成されないと Squirrel.exe が 7z.exe を見つけられず `electron-forge make` が失敗する
// （System.ComponentModel.Win32Exception: 指定されたファイルが見つかりません）。
// 同じ処理を os.arch() で正しくやり直す。electron-winstaller が無い/vendor構成が
// 変わった環境では何もしない。

import { copyFileSync, existsSync } from "node:fs";
import { arch } from "node:os";
import { resolve } from "node:path";

const vendorDir = resolve("node_modules/electron-winstaller/vendor");
const currentArch = arch();

for (const ext of ["exe", "dll"]) {
  const src = resolve(vendorDir, `7z-${currentArch}.${ext}`);
  const dest = resolve(vendorDir, `7z.${ext}`);
  if (existsSync(src) && !existsSync(dest)) {
    copyFileSync(src, dest);
    console.log(`[fix-electron-winstaller-7z] ${dest} を生成しました`);
  }
}

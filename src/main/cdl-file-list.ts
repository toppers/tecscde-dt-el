// 外部仕様5.3節: `.tecsgen-opts`の`-S`で指定されたディレクトリ（とその配下のサブディレクトリ）に
// `_CDL_FILES.txt`があるとき、`import`の参照先を、ディレクトリを直接調べる代わりに、この一覧から探す。
// 一覧は、そのディレクトリの**直下**のCDLファイル名を、1行に1つ書いたもの。`sub/x.cdl`なら、
// `sub`の一覧に`x.cdl`があるかを調べる（親の一覧は使わない）。

import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** 一覧のファイル名（そのディレクトリの直下に置く）。 */
export const CDL_FILE_LIST_NAME = "_CDL_FILES.txt";

/** 区切りを`/`にそろえ、先頭の`./`と余計な`/`を取る。 */
function normalizeEntry(text: string): string {
  let t = text.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (t.startsWith("./")) t = t.slice(2);
  return t;
}

/** 照合の鍵。Windowsでは大文字小文字を区別しない（外部仕様5.3節のパス比較と同じ）。 */
function matchKey(text: string): string {
  const t = normalizeEntry(text);
  return process.platform === "win32" ? t.toLowerCase() : t;
}

function dirKey(absDir: string): string {
  const t = resolve(absDir);
  return process.platform === "win32" ? t.toLowerCase() : t;
}

/** 一覧のテキストを「照合の鍵 → 一覧に書かれたとおりのファイル名」にする。空行は読み飛ばす。 */
export function parseCdlFileList(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const entry = normalizeEntry(line);
    if (entry === "") continue;
    entries.set(matchKey(entry), entry);
  }
  return entries;
}

/** ファイルの置き場所の一覧による判定。 */
export type ListLookup =
  | { readonly kind: "probe" } // 一覧は使わない（-S の外、または一覧が無い）。従来どおり調べる
  | { readonly kind: "listed"; readonly path: string } // 一覧に載っている。このパスを読む
  | { readonly kind: "unlisted" }; // 一覧はあるが載っていない。見つからない

/** 解決の1回分で使う、ディレクトリごとの一覧のキャッシュ。 */
export class CdlFileLists {
  private readonly cache = new Map<string, Promise<Map<string, string> | undefined>>();

  /** @param systemDirs `-S`のディレクトリ（絶対パス） */
  constructor(readonly systemDirs: readonly string[]) {}

  /** このディレクトリが、`-S`のディレクトリ自身か、その配下か。 */
  isUnderSystemDir(absDir: string): boolean {
    return this.systemDirs.some((systemDir) => {
      const rel = relative(systemDir, absDir);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  }

  private list(absDir: string): Promise<Map<string, string> | undefined> {
    const key = dirKey(absDir);
    let entry = this.cache.get(key);
    if (!entry) {
      entry = fs.readFile(join(absDir, CDL_FILE_LIST_NAME)).then(
        (buf) => parseCdlFileList(buf.toString("utf8")),
        () => undefined, // 一覧が無い（または読めない）ディレクトリは、従来どおりディレクトリを調べる
      );
      this.cache.set(key, entry);
    }
    return entry;
  }

  /**
   * 参照先として考えているファイル（絶対パス）について、そのファイルが入っているディレクトリの
   * 一覧で判定する。`-S`の配下のディレクトリで、一覧があるときだけ、一覧に従う。
   */
  async lookup(absFilePath: string): Promise<ListLookup> {
    const dir = dirname(absFilePath);
    if (!this.isUnderSystemDir(dir)) return { kind: "probe" };
    const list = await this.list(dir);
    if (!list) return { kind: "probe" };
    const entry = list.get(matchKey(basename(absFilePath)));
    return entry === undefined ? { kind: "unlisted" } : { kind: "listed", path: join(dir, entry) };
  }
}

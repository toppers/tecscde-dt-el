// 外部仕様5.3節: `.tecsgen-opts`の`-S`で指定されたディレクトリに`_CDL_FILES.txt`があるとき、
// そのディレクトリを直接調べる代わりに、この一覧から`import`の参照先を探す。
// 一覧は1行に1ファイル、`-S`のディレクトリを基点にした相対パス。

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

/** 一覧のファイル名（`-S`のディレクトリ直下に置く）。 */
export const CDL_FILE_LIST_NAME = "_CDL_FILES.txt";

/** 区切りを`/`にそろえ、先頭の`./`と余計な`/`を取る。一覧と`import`の指定の両方に使う。 */
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

/** 一覧のテキストを「照合の鍵 → 一覧に書かれたとおりの相対パス」にする。空行は読み飛ばす。 */
export function parseCdlFileList(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const entry = normalizeEntry(line);
    if (entry === "") continue;
    entries.set(matchKey(entry), entry);
  }
  return entries;
}

/** 解決の1回分で使う、`-S`のディレクトリごとの一覧。最初に`load()`でまとめて読む。 */
export class CdlFileLists {
  private readonly byDir = new Map<string, Map<string, string>>();

  constructor(readonly systemDirs: readonly string[]) {}

  async load(): Promise<void> {
    await Promise.all(
      this.systemDirs.map(async (systemDir) => {
        try {
          const buf = await fs.readFile(join(systemDir, CDL_FILE_LIST_NAME));
          this.byDir.set(dirKey(systemDir), parseCdlFileList(buf.toString("utf8")));
        } catch {
          // 一覧が無い（または読めない）ディレクトリは、従来どおりディレクトリを調べる。
        }
      }),
    );
  }

  /** このディレクトリ（絶対パス）が、一覧を持つ`-S`のディレクトリか。 */
  hasList(absDir: string): boolean {
    return this.byDir.has(dirKey(absDir));
  }

  /** 一覧に載っていれば、一覧に書かれたとおりの相対パス。載っていなければ undefined。 */
  find(absDir: string, specifier: string): string | undefined {
    return this.byDir.get(dirKey(absDir))?.get(matchKey(specifier));
  }
}

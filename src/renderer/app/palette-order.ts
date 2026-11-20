// V0.3.1 段1 — セルタイプ一覧の名前空間別グルーピングと昇順ソート（純関数）。
// 名前空間無しのグループを先頭に置き、以降は名前空間名の昇順。各グループ内ではセルタイプ名の昇順に並べる。

import type { CelltypeRef } from "../model/celltype";

export interface CelltypeGroup {
  /** 名前空間名。名前空間なしの場合は null。 */
  readonly namespace: string | null;
  readonly celltypes: readonly CelltypeRef[];
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** 修飾名（例: `nMruby::tBridge`）から末尾のセルタイプ名部分を取り出す。 */
export function shortCelltypeName(name: string): string {
  const separator = name.lastIndexOf("::");
  return separator >= 0 ? name.slice(separator + 2) : name;
}

/** セルタイプ一覧の項目の先頭に付ける、種類の印。複合セルタイプは `[C]`、通常のセルタイプは `[N]`。 */
export type CelltypeKindMark = "[C]" | "[N]";

/**
 * セルタイプの種類の印を返す（外部仕様3.1.x項目3、内部仕様2B.1）。
 * 複合セルタイプは `composite`（内部構造）を持つ。MrubyBridgePluginの橋渡し用セルタイプなど、持たないものは通常扱い。
 * 表示名（短い名前／完全修飾名）には影響しない。
 */
export function celltypeKindMark(celltype: CelltypeRef): CelltypeKindMark {
  return celltype.composite !== undefined ? "[C]" : "[N]";
}

/**
 * セルタイプ一覧を名前空間でグループ化し、並び替えて返す。
 * - 名前空間なし（`namespace === undefined`）のグループを先頭にする。
 * - 名前空間ありのグループは名前空間名の昇順にする。
 * - 各グループ内はセルタイプ名（短縮名、同値時はフル名）の昇順にする。
 */
export function groupAndSortCelltypes(celltypes: readonly CelltypeRef[]): readonly CelltypeGroup[] {
  if (celltypes.length === 0) return [];
  const byNamespace = new Map<string | null, CelltypeRef[]>();
  for (const celltype of celltypes) {
    const key = celltype.namespace ?? null;
    const bucket = byNamespace.get(key);
    if (bucket) bucket.push(celltype);
    else byNamespace.set(key, [celltype]);
  }
  const keys = Array.from(byNamespace.keys()).sort((a, b) => {
    if (a === null) return b === null ? 0 : -1;
    if (b === null) return 1;
    return compareStrings(a, b);
  });
  return keys.map((namespace) => ({
    namespace,
    celltypes: byNamespace
      .get(namespace)!
      .sort((a, b) => compareStrings(shortCelltypeName(a.name), shortCelltypeName(b.name)) || compareStrings(a.name, b.name)),
  }));
}

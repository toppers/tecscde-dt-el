// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.4 — リージョンの色の割り当て。
//
// 「同じリージョンには常に同じ色」（外部仕様7.5.2）を満たすため、リージョンIDの文字列の
// ハッシュ（FNV-1a, 32ビット）でパレットの番号を決める。登録順や木の形に依存しないので、
// リージョンが増減しても、別のファイルを開いても、同じIDは同じ色になる。衝突は許容する
// （色だけに依存させない方針。識別は凡例で補う）。根（`::`）は色分けの対象外。

import { ROOT_REGION_ID, type RegionId } from "../model/ids";
import type { Region, RegionTree } from "../model/region";

/** 色覚の多様性に配慮した、彩度を抑えた12色（暫定、6B.4）。 */
export const REGION_PALETTE: readonly string[] = [
  "#4e79a7",
  "#f28e2b",
  "#59a14f",
  "#e15759",
  "#76b7b2",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#8cd17d",
  "#86bcb6",
  "#d4a6c8",
];

/** FNV-1a（32ビット）。文字列をUTF-16コード単位で畳み込む。 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** リージョンの色。根は無色（`undefined`）。 */
export function regionColor(id: RegionId): string | undefined {
  if (id === ROOT_REGION_ID) return undefined;
  return REGION_PALETTE[fnv1a32(id) % REGION_PALETTE.length];
}

function walk(region: Region, visit: (r: Region) => void): void {
  visit(region);
  for (const child of region.children) walk(child, visit);
}

/** 木の全リージョン（根を除く）の色表。 */
export function regionColorMap(regions: RegionTree): ReadonlyMap<RegionId, string> {
  const colors = new Map<RegionId, string>();
  walk(regions.root, (r) => {
    const color = regionColor(r.id);
    if (color !== undefined) colors.set(r.id, color);
  });
  return colors;
}

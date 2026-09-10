// [[TECSCDE-DT-EL内部仕様]] 第6章6.4節 — 検索。
//
// `ViewState.searchQuery` はフィルタ（`DisplayFilters`）とは独立にモデル全体を対象として
// 検索する（7.4節）。フィルタで非表示の要素がヒットした場合はフィルタを一時的に緩めて
// 強調表示する（7.4.2）——本関数は「そのヒットが現在の非表示リージョンに属するか」を
// `revealed` として返し、緩和の判断材料を描画側（モジュールE/G）に渡す。
//
// 境界: 本モジュール（F）の永続状態（`ViewState`）はモデルへの参照を持たない（7章冒頭）。
// 検索は状態を持たない純関数として、呼び出しごとに `TecscdeDocument` を引数で受け取る
// （`HitTester` が doc を「実質的に不変な値」として扱うのと同じ考え方）。
//
// 検索ハイライトの巡回機構（次ヒットへジャンプ）は、第8章（未着手）の警告一覧からの
// ジャンプ操作としても共用する予定（7.4.2）。本ファイルは順序の定まったヒット列までを
// 提供し、巡回のカーソル保持はモジュールGが担う。

import type { CellId, JoinId, RegionId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";

export type SearchHit =
  | { readonly kind: "cell"; readonly cellId: CellId; readonly label: string; readonly revealed: boolean }
  | { readonly kind: "join"; readonly joinId: JoinId; readonly label: string; readonly revealed: boolean };

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * モデル全体を `query` で検索する。マッチ対象はセル名・セルタイプ名・ポート名／シグニチャ名・
 * 結合の呼び口／受け口名・リージョンの名前空間パス。
 *
 * @param hiddenRegionIds 現在のフィルタで非表示のリージョン集合（`ViewState.toCanvasView` の結果）。
 *   ここに属するセルにヒットした場合 `revealed: true`（一時的な緩和対象、7.4.2）。
 */
export function searchDocument(
  doc: TecscdeDocument,
  query: string | null,
  hiddenRegionIds: ReadonlySet<RegionId> = new Set(),
): SearchHit[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [];

  const hits: SearchHit[] = [];

  for (const cell of doc.cellValues()) {
    const region = doc.regions.findById(cell.regionId);
    const fields = [
      cell.name,
      cell.celltypeName,
      region?.namespacePath ?? "",
      ...cell.cports.flatMap((p) => [p.name, p.signature]),
      ...cell.eports.flatMap((p) => [p.name, p.signature]),
    ];
    if (fields.some((f) => matches(f, needle))) {
      hits.push({
        kind: "cell",
        cellId: cell.id,
        label: cell.name,
        revealed: hiddenRegionIds.has(cell.regionId),
      });
    }
  }

  for (const join of doc.joinValues()) {
    const source = doc.getCell(join.cellId);
    const target = doc.getCell(join.eportCellId);
    const label = `${source?.name ?? "?"}.${join.cportName} → ${target?.name ?? "?"}.${join.eportName}`;
    if (matches(`${join.cportName} ${join.eportName} ${label}`, needle)) {
      const bothHidden =
        source !== undefined &&
        target !== undefined &&
        hiddenRegionIds.has(source.regionId) &&
        hiddenRegionIds.has(target.regionId);
      hits.push({ kind: "join", joinId: join.id, label, revealed: bothHidden });
    }
  }

  return hits;
}

// [[TECSCDE-DT-EL内部仕様]] 第6章6.5節 — 表示フィルタ `DisplayFilters`。
//
// 本章は [[TECSCDE-TS内部仕様]] 第6章と「完全に同一、変更なし」（DT-EL内部仕様6章）であり、
// 挙動の正典は [[TECSCDE内部仕様]] 第7章7.5節。リージョン／ネームスペースフィルタ・
// 色分け表示・シグニチャ名表示の3種を独立したON/OFF状態として持つ。
//
// この状態はシリアライザ（第4章の対象外）が一切参照しない —— `.cde` に保存されない
// （外部仕様7.5.2）。`TecscdeDocument`（第3章）とは別の型に置くことで、その境界を
// 型システムでも表現する。本モジュール（F）はモデル（C）への参照を持たない
// （[[TECSCDE内部仕様]] 7章冒頭: 「`view-state/` 配下はモデルへの参照を持たず」）——
// `regionFilter` は解決済みの集合ではなく `RegionId` の生値で保持し、非表示リージョン
// 集合への解決は描画層アダプタ（`resolveHiddenRegionIds`）が `RegionTree` を受け取って行う。

import { ROOT_REGION_ID, type RegionId } from "../model/ids";
import type { Region, RegionTree } from "../model/region";

export class DisplayFilters {
  private constructor(
    /** 非 null のとき、このリージョンとその子孫のみを表示する（6.5節）。 */
    readonly regionFilter: RegionId | null,
    /** 非 null のとき、この名前空間パス（"::" 区切り）配下のみを表示する（7.5.2）。 */
    readonly namespaceFilter: string | null,
    /** リージョンごとの色分け表示（外部仕様7.5.1）。 */
    readonly colorByRegion: boolean,
    /** 結合のシグニチャ名ラベルを表示する（6.5節・`CanvasView.showSignatureNames`）。 */
    readonly showSignatureNames: boolean,
  ) {}

  /** すべて表示（フィルタなし）。既定状態。 */
  static allVisible(): DisplayFilters {
    return new DisplayFilters(null, null, false, false);
  }

  get isAllVisible(): boolean {
    return this.regionFilter === null && this.namespaceFilter === null;
  }

  withRegionFilter(regionId: RegionId | null): DisplayFilters {
    return new DisplayFilters(regionId, this.namespaceFilter, this.colorByRegion, this.showSignatureNames);
  }

  withNamespaceFilter(namespacePath: string | null): DisplayFilters {
    return new DisplayFilters(this.regionFilter, namespacePath, this.colorByRegion, this.showSignatureNames);
  }

  withColorByRegion(on: boolean): DisplayFilters {
    return new DisplayFilters(this.regionFilter, this.namespaceFilter, on, this.showSignatureNames);
  }

  withShowSignatureNames(on: boolean): DisplayFilters {
    return new DisplayFilters(this.regionFilter, this.namespaceFilter, this.colorByRegion, on);
  }

  equals(other: DisplayFilters): boolean {
    return (
      this.regionFilter === other.regionFilter &&
      this.namespaceFilter === other.namespaceFilter &&
      this.colorByRegion === other.colorByRegion &&
      this.showSignatureNames === other.showSignatureNames
    );
  }
}

function walk(region: Region, visit: (r: Region) => void): void {
  visit(region);
  for (const child of region.children) walk(child, visit);
}

function allRegions(tree: RegionTree): Region[] {
  const out: Region[] = [];
  walk(tree.root, (r) => out.push(r));
  return out;
}

function isNamespaceUnder(path: string, prefix: string): boolean {
  if (prefix === "::" || prefix === "") return true;
  return path === prefix || path.startsWith(`${prefix}::`);
}

/**
 * フィルタと `RegionTree` から、非表示にすべきリージョンID集合を導出する（6.5節）。
 * 描画層（`CanvasView.hiddenRegionIds`）はこの解決済み集合だけを読む。
 *
 * - `regionFilter` 指定時: そのリージョンと子孫のみ表示。
 * - `namespaceFilter` 指定時: その名前空間パス配下のみ表示。
 * - 両方指定時: 両条件を満たす（AND）リージョンのみ表示。
 * - どちらも null: 空集合（全表示）。
 *
 * 非表示リージョンに属するセルへの結合は描画側で完全には消さず境界にスタブを描く（7.5.2、
 * `JoinRenderer` の担当）——ここではあくまで「どのリージョンが非表示か」だけを返す。
 */
export function resolveHiddenRegionIds(
  filters: DisplayFilters,
  regions: RegionTree,
): ReadonlySet<RegionId> {
  if (filters.isAllVisible) return new Set();

  const regionList = allRegions(regions);

  let visibleIds: Set<RegionId> | null = null;

  if (filters.regionFilter !== null) {
    const root = regions.findById(filters.regionFilter);
    const subtree = new Set<RegionId>();
    if (root) walk(root, (r) => subtree.add(r.id));
    visibleIds = subtree;
  }

  if (filters.namespaceFilter !== null) {
    const ns = new Set<RegionId>();
    for (const r of regionList) {
      if (isNamespaceUnder(r.namespacePath, filters.namespaceFilter)) ns.add(r.id);
    }
    visibleIds = visibleIds === null ? ns : new Set([...visibleIds].filter((id) => ns.has(id)));
  }

  const hidden = new Set<RegionId>();
  for (const r of regionList) {
    if (r.id === ROOT_REGION_ID) continue; // 根は常に表示（セルは実リージョンに属する）
    if (!visibleIds || !visibleIds.has(r.id)) hidden.add(r.id);
  }
  return hidden;
}

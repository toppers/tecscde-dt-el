// [[TECSCDE-DT-EL内部仕様]] 第6章6.5節・第6B章 — 表示フィルタ `DisplayFilters`。
//
// 挙動の正典は [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]]（外部仕様7.5.2）。
// リージョン／ネームスペースのフィルタ・色分け表示・シグニチャ名表示の3種を独立した状態として
// 持つ。ネームスペースは `RegionId` と同じ文字列で木の階層に一致するため、独立したフィルタは
// 持たず、リージョンのチェック（非表示集合）に一本化している（6B.1）。
//
// この状態はシリアライザ（第4章の対象外）が一切参照しない —— `.cde` に保存されない
// （外部仕様7.5.2）。`TecscdeDocument`（第3章）とは別の型に置くことで、その境界を
// 型システムでも表現する。本モジュール（F）はモデル（C）への参照を持たない
// （[[TECSCDE内部仕様]] 7章冒頭: 「`view-state/` 配下はモデルへの参照を持たず」）——
// `hiddenRegions` は解決済みの集合ではなく `RegionId` の生値で保持し、非表示リージョン
// 集合への解決は描画層アダプタ（`resolveHiddenRegionIds`）が `RegionTree` を受け取って行う。

import { ROOT_REGION_ID, type RegionId } from "../model/ids";
import type { Region, RegionTree } from "../model/region";
import type { CellNameDisplayMode, NamespaceDisplayMode } from "../../shared/ipc-types";

export class DisplayFilters {
  private constructor(
    /** 利用者がチェックを外したリージョン。そのリージョンと全子孫が非表示（6B.2）。 */
    readonly hiddenRegions: ReadonlySet<RegionId>,
    /** リージョンごとの色分け表示（外部仕様7.5.2）。 */
    readonly colorByRegion: boolean,
    /** 結合のシグニチャ名ラベルを表示する。既定はオン（外部仕様7.5.2、現行版の常時表示を踏襲）。 */
    readonly showSignatureNames: boolean,
    /** セル名強調（外部仕様7.4.2）。オンでセル名を大きく表示し、セルタイプ名を隠す。既定はオフ。 */
    readonly emphasizeCellName: boolean,
    /** アクティブセルのみ表示（外部仕様7.5.x、内部仕様6C.1・監査#45）。既定はオフ。 */
    readonly activeOnly: boolean = false,
    /** V0.3.1 段2: セルタイプ名を表示する。既定はオン。 */
    readonly showCelltypeName: boolean = true,
    /** V0.3.1 段2: セル名の表示方式（表示・短縮・非表示）。既定は表示。 */
    readonly cellNameDisplay: CellNameDisplayMode = "show",
    /** V0.3.1 段2: 記号（色以外: RO / ! / U）を表示する。既定はオン。 */
    readonly showStatusSymbols: boolean = true,
    /** V0.3.1 段2: セル名・セルタイプ名の名前空間表示方式（表示・黒丸で代替）。既定は表示。 */
    readonly namespaceDisplay: NamespaceDisplayMode = "show",
  ) {}

  /** すべて表示（フィルタなし）。既定状態。 */
  static allVisible(): DisplayFilters {
    return new DisplayFilters(new Set(), false, true, false, false, true, "show", true, "show");
  }

  get isAllVisible(): boolean {
    return this.hiddenRegions.size === 0 && !this.activeOnly;
  }

  private copy(
    overrides: Partial<{
      hiddenRegions: ReadonlySet<RegionId>;
      colorByRegion: boolean;
      showSignatureNames: boolean;
      emphasizeCellName: boolean;
      activeOnly: boolean;
      showCelltypeName: boolean;
      cellNameDisplay: CellNameDisplayMode;
      showStatusSymbols: boolean;
      namespaceDisplay: NamespaceDisplayMode;
    }>,
  ): DisplayFilters {
    return new DisplayFilters(
      overrides.hiddenRegions ?? this.hiddenRegions,
      overrides.colorByRegion ?? this.colorByRegion,
      overrides.showSignatureNames ?? this.showSignatureNames,
      overrides.emphasizeCellName ?? this.emphasizeCellName,
      overrides.activeOnly ?? this.activeOnly,
      overrides.showCelltypeName ?? this.showCelltypeName,
      overrides.cellNameDisplay ?? this.cellNameDisplay,
      overrides.showStatusSymbols ?? this.showStatusSymbols,
      overrides.namespaceDisplay ?? this.namespaceDisplay,
    );
  }

  withRegionHidden(id: RegionId, hidden: boolean): DisplayFilters {
    if (this.hiddenRegions.has(id) === hidden) return this;
    const next = new Set(this.hiddenRegions);
    if (hidden) next.add(id);
    else next.delete(id);
    return this.copy({ hiddenRegions: next });
  }

  /** 検索のヒットを見せるため、指定したIDを非表示集合から外す（6B.8）。 */
  withRegionsRevealed(ids: Iterable<RegionId>): DisplayFilters {
    const next = new Set(this.hiddenRegions);
    let changed = false;
    for (const id of ids) changed = next.delete(id) || changed;
    return changed ? this.copy({ hiddenRegions: next }) : this;
  }

  withAllRegionsShown(): DisplayFilters {
    if (this.isAllVisible) return this;
    return this.copy({ hiddenRegions: new Set(), activeOnly: false });
  }

  withColorByRegion(on: boolean): DisplayFilters {
    return this.copy({ colorByRegion: on });
  }

  withShowSignatureNames(on: boolean): DisplayFilters {
    return this.copy({ showSignatureNames: on });
  }

  withEmphasizeCellName(on: boolean): DisplayFilters {
    return this.copy({ emphasizeCellName: on });
  }

  withActiveOnly(on: boolean): DisplayFilters {
    return this.copy({ activeOnly: on });
  }

  withShowCelltypeName(on: boolean): DisplayFilters {
    return this.copy({ showCelltypeName: on });
  }

  withCellNameDisplay(mode: CellNameDisplayMode): DisplayFilters {
    return this.copy({ cellNameDisplay: mode });
  }

  withShowStatusSymbols(on: boolean): DisplayFilters {
    return this.copy({ showStatusSymbols: on });
  }

  withNamespaceDisplay(mode: NamespaceDisplayMode): DisplayFilters {
    return this.copy({ namespaceDisplay: mode });
  }

  equals(other: DisplayFilters): boolean {
    if (this.colorByRegion !== other.colorByRegion) return false;
    if (this.showSignatureNames !== other.showSignatureNames) return false;
    if (this.emphasizeCellName !== other.emphasizeCellName) return false;
    if (this.activeOnly !== other.activeOnly) return false;
    if (this.showCelltypeName !== other.showCelltypeName) return false;
    if (this.cellNameDisplay !== other.cellNameDisplay) return false;
    if (this.showStatusSymbols !== other.showStatusSymbols) return false;
    if (this.namespaceDisplay !== other.namespaceDisplay) return false;
    if (this.hiddenRegions.size !== other.hiddenRegions.size) return false;
    for (const id of this.hiddenRegions) if (!other.hiddenRegions.has(id)) return false;
    return true;
  }
}

function walk(region: Region, visit: (r: Region) => void): void {
  visit(region);
  for (const child of region.children) walk(child, visit);
}

/**
 * フィルタと `RegionTree` から、非表示にすべきリージョンID集合を導出する（6B.2）。
 * 描画層（`CanvasView.hiddenRegionIds`）はこの解決済み集合だけを読む。
 *
 * - `hiddenRegions` の各リージョンについて、その部分木（子孫を含む）を非表示にし、和集合を返す。
 * - 根は常に表示する（セルは実リージョンに属する）。
 * - `RegionTree` に無いIDは無視する（別のファイルを開いた後などの取り残し）。
 *
 * 非表示リージョンに属するセルへの結合は描画側で完全には消さず境界にスタブを描く（7.5.2、
 * `JoinRenderer` の担当）——ここではあくまで「どのリージョンが非表示か」だけを返す。
 */
export function resolveHiddenRegionIds(
  filters: DisplayFilters,
  regions: RegionTree,
): ReadonlySet<RegionId> {
  const hidden = new Set<RegionId>();
  for (const id of filters.hiddenRegions) {
    if (id === ROOT_REGION_ID) continue; // 根のチェックは無視する（部分木ごと隠れてしまうため）
    const root = regions.findById(id);
    if (!root) continue;
    walk(root, (r) => {
      if (r.id !== ROOT_REGION_ID) hidden.add(r.id);
    });
  }
  return hidden;
}

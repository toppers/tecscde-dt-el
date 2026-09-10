// [[TECSCDE-DT-EL内部仕様]] 第6章6.1節 — 表示制御 `ViewState`。
//
// 本章は [[TECSCDE-TS内部仕様]] 第6章と「完全に同一、変更なし」（DT-EL内部仕様6章）。
// 挙動の正典は [[TECSCDE内部仕様]] 第7章。ズーム・パン・グリッド・表示フィルタ・検索の
// 状態を1つの不変クラスに集約する。`TecscdeDocument`（第3章）とは別の型にすることで
// 「表示状態はモデルの一部ではなく `.cde` に保存されない」（外部仕様7.5.2）を型で表現する。
//
// 本モジュール（F）はモデル（C）・パーサ（B）への参照を持たない
// （[[TECSCDE内部仕様]] 7章冒頭）。描画層（E）が読む面は `render/view.ts` の `CanvasView`
// interface であり、`ViewState` は `toCanvasView(regions)` でそれを満たすアダプタを返す
// （第5章の暫定 `defaultCanvasView()` を置き換える背骨がこのクラス）。
//
// 逸脱の記録: `panCenter` はモデル座標系での表示中心。描画層（`CanvasView`）は pan を
// SVG 変換ではなくシェル（モジュールG）のスクロールコンテナで実現するため `panCenter` を
// 読まない —— `panCenter` はナビゲータ（6.3節）とシェルのスクロール位置復元のための
// 状態である。`zoomAt`/`panBy` の座標系はモデル(mm)で、ビューポート寸法に依存しない
// 定式化にしている（シェルが panCenter ⇔ scrollLeft/Top を対応づける）。

import { DisplayFilters, resolveHiddenRegionIds } from "./display-filters";
import type { Point } from "../model/geometry";
import type { RegionId } from "../model/ids";
import type { RegionTree } from "../model/region";
import { MM_TO_PX, type CanvasView } from "../render/view";

/** ズーム下限（外部仕様3.2.1: 5%）。 */
export const ZOOM_MIN = 0.05;
/** ズーム上限（外部仕様3.2.1: 200%）。 */
export const ZOOM_MAX = 2.0;
/** キーボード（Ctrl+ / Ctrl−、外部仕様7.1.2）1段あたりの倍率。 */
export const ZOOM_STEP = 1.1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export class ViewState {
  private constructor(
    /** 1.0 = 100%（外部仕様3.2.1: 5%〜200%）。 */
    readonly zoom: number,
    /** モデル座標系での表示中心。描画層は読まない（ナビゲータ・シェル用、上記コメント参照）。 */
    readonly panCenter: Point,
    /** グリッド線の表示。既定 false（現行版と同じ見た目、6.2節）。 */
    readonly gridVisible: boolean,
    /** リージョン／ネームスペース／シグニチャ名表示（6.5節）。 */
    readonly filters: DisplayFilters,
    /** モデル全体を対象とする検索クエリ。空は null（6.4節）。 */
    readonly searchQuery: string | null,
  ) {}

  static initial(): ViewState {
    return new ViewState(1.0, { x: 0, y: 0 }, false, DisplayFilters.allVisible(), null);
  }

  /**
   * 倍率を `factor` 倍する。`anchor`（モデル座標）にあった点が変更後も同じ画面位置に
   * 残るよう `panCenter` を再計算する（7.1.2: 現行版の「左上基準でずれる」欠落の解消。
   * Ctrl+ホイールではポインタ位置、キーボードでは表示中心を `anchor` に渡す）。
   *
   * 画面位置の不変条件: `(anchor - panCenter) * zoom` を一定に保つ。
   * ⇒ `panCenter' = anchor - (anchor - panCenter) * (zoom / zoom')`。
   * 倍率がクランプで頭打ちのときは `zoom' == zoom` となり `panCenter` は変わらない。
   */
  zoomAt(anchor: Point, factor: number): ViewState {
    const nextZoom = clampZoom(this.zoom * factor);
    const ratio = this.zoom / nextZoom;
    const panCenter: Point = {
      x: anchor.x - (anchor.x - this.panCenter.x) * ratio,
      y: anchor.y - (anchor.y - this.panCenter.y) * ratio,
    };
    return new ViewState(nextZoom, panCenter, this.gridVisible, this.filters, this.searchQuery);
  }

  /** 倍率を保ったまま表示中心をリセットする（Ctrl+0 相当、7.1.2）。 */
  resetZoom(): ViewState {
    return new ViewState(1.0, this.panCenter, this.gridVisible, this.filters, this.searchQuery);
  }

  /** 表示中心をモデル座標 `delta` だけ動かす（スペース+ドラッグ／スクロール、7.1.2）。 */
  panBy(delta: Point): ViewState {
    const panCenter: Point = { x: this.panCenter.x + delta.x, y: this.panCenter.y + delta.y };
    return new ViewState(this.zoom, panCenter, this.gridVisible, this.filters, this.searchQuery);
  }

  /** 表示中心をモデル座標 `center` に合わせる（ナビゲータのクリック等）。 */
  panTo(center: Point): ViewState {
    return new ViewState(this.zoom, center, this.gridVisible, this.filters, this.searchQuery);
  }

  toggleGrid(): ViewState {
    return new ViewState(this.zoom, this.panCenter, !this.gridVisible, this.filters, this.searchQuery);
  }

  withFilters(filters: DisplayFilters): ViewState {
    return new ViewState(this.zoom, this.panCenter, this.gridVisible, filters, this.searchQuery);
  }

  withSearchQuery(query: string | null): ViewState {
    const normalized = query && query.trim() !== "" ? query : null;
    return new ViewState(this.zoom, this.panCenter, this.gridVisible, this.filters, normalized);
  }

  /** モデル座標(mm)1つあたりの画面ピクセル数。 */
  get pxPerMm(): number {
    return MM_TO_PX * this.zoom;
  }

  /**
   * 描画層（モジュールE）が読む最小面 `CanvasView` へ射影する。第6章6.5節のフィルタは
   * ここで `RegionTree` を使い非表示リージョンID集合へ解決される（`ViewState` 自体は
   * モデルを参照しない）。
   */
  toCanvasView(regions: RegionTree): CanvasView {
    const hiddenRegionIds: ReadonlySet<RegionId> = resolveHiddenRegionIds(this.filters, regions);
    return {
      zoom: this.zoom,
      gridVisible: this.gridVisible,
      showSignatureNames: this.filters.showSignatureNames,
      hiddenRegionIds,
    };
  }
}

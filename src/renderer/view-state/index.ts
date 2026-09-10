// [[TECSCDE-DT-EL内部仕様]] 第6章 — 表示制御（モジュールF）の公開面。
// 第2章2.3節のとおり renderer プロセスで完結する。モデル（C）・パーサ（B）への
// 参照は持たない（[[TECSCDE内部仕様]] 7章冒頭）。

export { ViewState, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, clampZoom } from "./view-state";
export { DisplayFilters, resolveHiddenRegionIds } from "./display-filters";
export {
  computeNavigator,
  visibleModelRect,
  navigatorPointToPanCenter,
  type Viewport,
  type ModelRect,
  type NavigatorModel,
} from "./navigator";
export { searchDocument, type SearchHit } from "./search";

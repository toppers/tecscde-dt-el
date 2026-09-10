// [[TECSCDE-DT-EL内部仕様]] 第6章6.1節の逸脱の実体 — モジュールG が持つ
// `ViewState.panCenter`（モデル座標系での表示中心, mm）と、スクロールコンテナの
// `scrollLeft`/`scrollTop`（px）との相互変換。
//
// view-state.ts のヘッダコメントが明記するとおり、描画層（`CanvasView`）は pan を
// SVG 変換ではなくシェルのスクロールで実現するため `panCenter` を読まない。
// その「シェル側が持つ対応づけ」がこの純関数ペアである。DOM には触れない。

import type { Point } from "../model/geometry";

/** ピクセル単位の2次元サイズ／位置。 */
export interface PxSize {
  readonly width: number;
  readonly height: number;
}

export interface ScrollPos {
  readonly left: number;
  readonly top: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return 0; // コンテンツがビューポートより小さい（スクロール不能）
  return Math.min(max, Math.max(min, value));
}

/**
 * 表示中心 `panCenter`(mm) を、それを実現するスクロール位置(px)へ変換する。
 * コンテンツがビューポートに収まる軸では 0 にクランプされる。
 */
export function scrollForPanCenter(
  pxPerMm: number,
  panCenter: Point,
  viewport: PxSize,
  content: PxSize,
): ScrollPos {
  const rawLeft = panCenter.x * pxPerMm - viewport.width / 2;
  const rawTop = panCenter.y * pxPerMm - viewport.height / 2;
  return {
    left: clamp(rawLeft, 0, content.width - viewport.width),
    top: clamp(rawTop, 0, content.height - viewport.height),
  };
}

/**
 * 現在のスクロール位置(px)から、対応する表示中心 `panCenter`(mm) を求める。
 * `scrollForPanCenter` の逆関数（クランプ域内では往復一致する）。
 */
export function panCenterFromScroll(pxPerMm: number, scroll: ScrollPos, viewport: PxSize): Point {
  return {
    x: (scroll.left + viewport.width / 2) / pxPerMm,
    y: (scroll.top + viewport.height / 2) / pxPerMm,
  };
}

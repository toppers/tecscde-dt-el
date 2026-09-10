// [[TECSCDE-DT-EL内部仕様]] 第6章6.3節 — ナビゲータ。
//
// 用紙全体の縮小表示＋現在の表示範囲を示す矩形は、`ViewState`（`zoom`・`panCenter`）と
// `PaperSpec`（第3章の `TecscdeDocument` が保持）の両方から算出する読み取り専用の派生値
// であり、`ViewState` 自体にフィールドとして持たせない（6.3節）。用紙全体が表示範囲に
// 収まる縮小率のときは自動非表示にする（7.3.2）。
//
// 実 DOM（ナビゲータの描画・クリック）はモジュールG。本ファイルはその素材となる純粋な
// 幾何計算のみを提供し、ヘッドレスで検証する（第5章の SVG 描画クラスと同じ方針）。

import { MM_TO_PX } from "../render/view";
import type { Point } from "../model/geometry";
import type { PaperSpec } from "../model/paper";
import type { ViewState } from "./view-state";

/** ビューポート（キャンバスの可視領域）の画面ピクセル寸法。 */
export interface Viewport {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** 軸並行矩形（モデル座標 mm）。 */
export interface ModelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NavigatorModel {
  /** 用紙の内容領域サイズ（余白を除く、mm）。 */
  readonly paper: { readonly width: number; readonly height: number };
  /** 現在ビューポートに映っているモデル座標範囲（mm）。用紙外へはみ出しうる。 */
  readonly viewport: ModelRect;
  /** 用紙全体がビューポートに収まる → ナビゲータを自動的に隠す（7.3.2）。 */
  readonly autoHidden: boolean;
}

function pxPerMm(view: ViewState): number {
  return MM_TO_PX * view.zoom;
}

/** ビューポート中心のモデル座標が `panCenter`、という対応でモデル可視範囲を求める。 */
export function visibleModelRect(view: ViewState, viewport: Viewport): ModelRect {
  const k = pxPerMm(view);
  const wMm = viewport.widthPx / k;
  const hMm = viewport.heightPx / k;
  return { x: view.panCenter.x - wMm / 2, y: view.panCenter.y - hMm / 2, width: wMm, height: hMm };
}

export function computeNavigator(view: ViewState, paper: PaperSpec, viewport: Viewport): NavigatorModel {
  const { width, height } = paper.contentSize();
  const vr = visibleModelRect(view, viewport);
  const autoHidden =
    vr.x <= 0 && vr.y <= 0 && vr.x + vr.width >= width && vr.y + vr.height >= height;
  return { paper: { width, height }, viewport: vr, autoHidden };
}

/** ナビゲータ上のクリック位置（用紙を [0,1]×[0,1] に正規化した座標）を表示中心へ変換する。 */
export function navigatorPointToPanCenter(paper: PaperSpec, normalized: Point): Point {
  const { width, height } = paper.contentSize();
  return { x: normalized.x * width, y: normalized.y * height };
}

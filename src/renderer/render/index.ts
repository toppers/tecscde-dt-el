// [[TECSCDE-DT-EL内部仕様]] 第5章 — 描画・インタラクション（モジュールE）の公開面。
// 第2章2.3節のとおり、このモジュールはすべて renderer プロセスで動作する。

export {
  MM_TO_PX,
  pxPerMm,
  pxToMm,
  defaultCanvasView,
  SelectionState,
  type CanvasView,
  type Rect,
} from "./view";
export { ElementRenderer, svgEl, setAttrs } from "./element-renderer";
export { joinPolyline } from "./svg-path";
export { CellRenderer, type CellRenderContext } from "./cell-renderer";
export { JoinRenderer, type JoinRenderContext } from "./join-renderer";
export { SvgRenderer, type JoinPreviewLine, type RenderOptions } from "./svg-renderer";
export { HitTester, type HitResult } from "./hit-tester";
export {
  GestureController,
  type GestureHost,
  type GesturePreviewSink,
  type Mods,
  type PortRef,
} from "./gesture-controller";

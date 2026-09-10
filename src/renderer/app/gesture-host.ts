// [[TECSCDE-DT-EL内部仕様]] 第5章5.3節 — `GestureController` が発行先とする窓口
// `GestureHost` を、モジュールG の `AppStore` の上に実装する。
//
// `GestureController` は「E・G は D を介してのみモデルを変更できる」（第2章2.2節）ことを
// コードレベルで保証する層であり、その `dispatch` はこのアダプタを通って `AppStore` の
// `History.commit` に落ちる。`getView()` はここで `ViewState.toCanvasView()` を呼び、
// 描画・ヒットテストが読む最小面（`CanvasView`）へ射影する。

import type { GestureHost } from "../render/gesture-controller";
import type { CanvasView, SelectionState } from "../render/view";
import type { Command } from "../commands/command";
import type { TecscdeDocument } from "../model/document";
import type { Point } from "../model/geometry";
import type { AppStore } from "./store";

export class AppGestureHost implements GestureHost {
  constructor(
    private readonly store: AppStore,
    /** シェルの再描画関数（プレビュー追従・状態反映）。 */
    private readonly requestRenderFn: () => void,
    /** ステータスバーへポインタのモデル座標を出すためのコールバック（任意）。 */
    private readonly onPointerModelPositionFn?: (point: Point | undefined) => void,
  ) {}

  getDocument(): TecscdeDocument {
    return this.store.getDocument();
  }

  getView(): CanvasView {
    return this.store.view.toCanvasView(this.store.getDocument().regions);
  }

  getSelection(): SelectionState {
    return this.store.selection;
  }

  setSelection(sel: SelectionState): void {
    this.store.setSelection(sel);
  }

  dispatch(command: Command): void {
    this.store.dispatch(command);
  }

  getMode(): "select" | "newCell" {
    return this.store.getMode();
  }

  getActiveCelltypeName(): string | undefined {
    return this.store.getActiveCelltypeName();
  }

  onPointerModelPosition(point: Point | undefined): void {
    this.onPointerModelPositionFn?.(point);
  }

  requestRender(): void {
    this.requestRenderFn();
  }
}

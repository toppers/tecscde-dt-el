// [[TECSCDE-DT-EL内部仕様]] 第6章6.3節・第3章3.5節・7.1節・7.3.2 — ナビゲータ（モジュールG次段）。
// `computeNavigator`/`navigatorPointToPanCenter`（純粋な幾何計算、view-state/navigator.ts）を
// 実DOM（SVGミニマップ）へ配線する。用紙全体が表示範囲に収まるときは自動的に隠す（7.3.2）。
// クリック位置→パン中心の変換はテスト済みの純関数側にあり、ここでは`getBoundingClientRect()`
// に基づく画面座標→正規化座標の変換のみを行う——happy-domはレイアウトを持たないため、
// この最後の一段（実ピクセル座標）はheadlessテストの対象外とし、`electron .`での目視確認に委ねる
// （第5・6章のSVG幾何確認と同じ方針、[[TECSCDE-DT-EL実装]]参照）。

import { computeNavigator, navigatorPointToPanCenter, type Viewport } from "../view-state/navigator";
import type { AppStore } from "./store";

const SVG_NS = "http://www.w3.org/2000/svg";

export class NavigatorView {
  private readonly svg: SVGSVGElement;
  private readonly paperRect: SVGRectElement;
  private readonly viewportRect: SVGRectElement;
  private visible = true;
  private dragging = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    private readonly scrollEl: HTMLElement,
  ) {
    const svg = this.root.querySelector<SVGSVGElement>("svg");
    if (!svg) throw new Error("NavigatorView: <svg>が見つかりません");
    this.svg = svg;
    // クリック位置をviewBox座標へそのまま対応させるため、アスペクト比を保たず引き伸ばす。
    this.svg.setAttribute("preserveAspectRatio", "none");
    this.paperRect = this.createRect("navigator-paper");
    this.viewportRect = this.createRect("navigator-viewport");
    this.svg.append(this.paperRect, this.viewportRect);

    // 外部仕様7.3.2: クリックまたはドラッグで、その位置を表示範囲の中央に移動する。
    // 押した位置へ移し（クリック）、押している間はポインタに追従させる（ドラッグ）。
    // 枠の外へ出ても追従が切れないよう、移動と離すのはウィンドウ側で受ける。
    const win = this.root.ownerDocument.defaultView ?? window;
    this.svg.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.panToPointer(e);
      e.preventDefault();
    });
    win.addEventListener("mousemove", (e) => {
      if (this.dragging) this.panToPointer(e);
    });
    win.addEventListener("mouseup", () => {
      this.dragging = false;
    });
  }

  /** ポインタ位置（画面座標）を用紙上の正規化座標に直し、その点を表示中心にする。 */
  private panToPointer(e: MouseEvent): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // 用紙の外へドラッグしても中心が用紙の外へ出ないよう、[0,1]に収める。
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const doc = this.store.getDocument();
    this.store.setView(this.store.view.panTo(navigatorPointToPanCenter(doc.paper, { x: nx, y: ny })));
  }

  private createRect(className: string): SVGRectElement {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("class", className);
    return el;
  }

  /** 外部仕様3.5節: 表示/非表示を切り替えられるものとする。 */
  toggle(): void {
    this.visible = !this.visible;
    this.render();
  }

  render(): void {
    const doc = this.store.getDocument();
    const viewport: Viewport = { widthPx: this.scrollEl.clientWidth, heightPx: this.scrollEl.clientHeight };
    const model = computeNavigator(this.store.view, doc.paper, viewport);
    const hidden = !this.visible || model.autoHidden;
    this.root.hidden = hidden;
    if (hidden) return;

    const { width: pw, height: ph } = model.paper;
    this.svg.setAttribute("viewBox", `0 0 ${pw} ${ph}`);
    this.paperRect.setAttribute("x", "0");
    this.paperRect.setAttribute("y", "0");
    this.paperRect.setAttribute("width", String(pw));
    this.paperRect.setAttribute("height", String(ph));

    const vp = model.viewport;
    this.viewportRect.setAttribute("x", String(vp.x));
    this.viewportRect.setAttribute("y", String(vp.y));
    this.viewportRect.setAttribute("width", String(vp.width));
    this.viewportRect.setAttribute("height", String(vp.height));
  }
}

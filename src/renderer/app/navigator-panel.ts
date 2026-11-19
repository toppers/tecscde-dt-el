// [[TECSCDE-DT-EL内部仕様]] 第6章6.3節・第3章3.5節・7.1節・外部仕様7.1.2 — ナビゲータ（モジュールG次段）。
// `computeNavigator`/`navigatorPointToPanCenter`（純粋な幾何計算、view-state/navigator.ts）を
// 実DOM（SVGミニマップ）へ配線する。用紙全体が表示範囲に収まるときは自動的に隠す（外部仕様7.1.2）。
// 三者相違一覧2-18（監査#56）: 用紙枠・表示範囲枠に加えて、可視セルと結合の縮小図を描く。

import { computeNavigator, navigatorPointToPanCenter, type Viewport } from "../view-state/navigator";
import { isCellVisible } from "../render/cell-visibility";
import type { AppStore } from "./store";

const SVG_NS = "http://www.w3.org/2000/svg";

export class NavigatorView {
  private readonly svg: SVGSVGElement;
  private readonly paperRect: SVGRectElement;
  private readonly minimapGroup: SVGGElement;
  private readonly viewportRect: SVGRectElement;
  /** 利用者の指定。`auto` は用紙全体が収まるときだけ自動で隠す（外部仕様7.1.2）。`shown`・`hidden` は自動判定に勝つ。 */
  private override: "auto" | "shown" | "hidden" = "auto";
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
    this.minimapGroup = document.createElementNS(SVG_NS, "g");
    this.minimapGroup.setAttribute("class", "navigator-minimap");
    this.viewportRect = this.createRect("navigator-viewport");
    this.svg.append(this.paperRect, this.minimapGroup, this.viewportRect);

    // 外部仕様7.1.2: クリックまたはドラッグで、その位置を表示範囲の中央に移動する。
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

  /**
   * 外部仕様3.5節: 表示/非表示を切り替えられるものとする。いま見えていれば隠し、隠れていれば
   * （自動非表示の最中でも）見せる。以後は自動判定ではなく利用者の指定に従う。
   */
  toggle(): void {
    this.override = this.root.hidden ? "shown" : "hidden";
    this.render();
  }

  render(): void {
    const doc = this.store.getDocument();
    const viewport: Viewport = { widthPx: this.scrollEl.clientWidth, heightPx: this.scrollEl.clientHeight };
    const model = computeNavigator(this.store.view, doc.paper, viewport);
    const hidden = this.override === "hidden" || (this.override === "auto" && model.autoHidden);
    this.root.hidden = hidden;
    if (hidden) return;

    const { width: pw, height: ph } = model.paper;
    this.svg.setAttribute("viewBox", `0 0 ${pw} ${ph}`);
    this.paperRect.setAttribute("x", "0");
    this.paperRect.setAttribute("y", "0");
    this.paperRect.setAttribute("width", String(pw));
    this.paperRect.setAttribute("height", String(ph));

    // 三者相違一覧2-18: 可視セルと結合の縮小表示を描く
    this.minimapGroup.replaceChildren();
    const canvasView = this.store.view.toCanvasView(doc.regions);
    const visibleIds = new Set<string>();
    for (const cell of doc.cellValues()) {
      if (!isCellVisible(doc, cell, canvasView)) continue;
      visibleIds.add(cell.id);
    }
    for (const join of doc.joinValues()) {
      if (!visibleIds.has(join.cellId) || !visibleIds.has(join.eportCellId)) continue;
      if (join.bars.length === 0) continue;
      const pts: string[] = [];
      for (const bar of join.bars) {
        const ax = bar.direction === "H" ? bar.from : bar.fixed;
        const ay = bar.direction === "H" ? bar.fixed : bar.from;
        const bx = bar.direction === "H" ? bar.to : bar.fixed;
        const by = bar.direction === "H" ? bar.fixed : bar.to;
        if (pts.length === 0) pts.push(`${ax},${ay}`);
        pts.push(`${bx},${by}`);
      }
      const poly = document.createElementNS(SVG_NS, "polyline");
      poly.setAttribute("class", "navigator-join");
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#6e7781");
      poly.setAttribute("stroke-width", "0.8");
      this.minimapGroup.appendChild(poly);
    }
    for (const cell of doc.cellValues()) {
      if (!visibleIds.has(cell.id)) continue;
      const r = this.createRect("navigator-cell");
      r.setAttribute("x", String(cell.x));
      r.setAttribute("y", String(cell.y));
      r.setAttribute("width", String(cell.width));
      r.setAttribute("height", String(cell.height));
      r.setAttribute("fill", "#d0d7de");
      r.setAttribute("stroke", "#57606a");
      r.setAttribute("stroke-width", "0.8");
      this.minimapGroup.appendChild(r);
    }

    const vp = model.viewport;
    this.viewportRect.setAttribute("x", String(vp.x));
    this.viewportRect.setAttribute("y", String(vp.y));
    this.viewportRect.setAttribute("width", String(vp.width));
    this.viewportRect.setAttribute("height", String(vp.height));
  }
}

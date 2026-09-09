// [[TECSCDE-DT-EL内部仕様]] 第5章5.1節 — 結合1本の `<g>`（折れ線＋シグニチャラベル）を描く
// `JoinRenderer`。`CellRenderer` とは独立しており、片方の変更が他方に影響しないことが
// 型（`ElementRenderer<Join>` vs `ElementRenderer<Cell>`）で明確になる。

import { ElementRenderer, setAttrs, svgEl } from "./element-renderer";
import { joinPolyline } from "./svg-path";
import { pxPerMm, type CanvasView } from "./view";
import type { Cell } from "../model/cell";
import type { Bar, Join } from "../model/join";
import type { Point } from "../model/geometry";

export interface JoinRenderContext {
  readonly view: CanvasView;
  /** 呼び口側セル（`join.cellId` の実体）。 */
  readonly source: Cell;
  /** 受け口側セル（`join.eportCellId` の実体）。 */
  readonly target: Cell;
  /** ドラッグ中プレビュー用に経路を差し替える場合のみ指定（通常は `join.bars`）。 */
  readonly bars?: readonly Bar[];
}

function pointsAttr(points: readonly Point[], k: number): string {
  return points.map((p) => `${p.x * k},${p.y * k}`).join(" ");
}

export class JoinRenderer extends ElementRenderer<Join, JoinRenderContext> {
  override createElement(join: Join, ctx: JoinRenderContext): SVGGElement {
    const group = svgEl("g");
    group.dataset["joinId"] = join.id;
    this.updateElement(join, group, ctx);
    return group;
  }

  override updateElement(join: Join, element: SVGGElement, ctx: JoinRenderContext): void {
    element.replaceChildren();
    const points = joinPolyline(join, ctx.source, ctx.target, ctx.bars ?? join.bars);
    if (!points || points.length < 2) return;

    const k = pxPerMm(ctx.view);
    const line = svgEl("polyline");
    setAttrs(line, { points: pointsAttr(points, k) });
    line.setAttribute("class", "join-line");
    line.setAttribute("fill", "none");
    element.appendChild(line);

    if (ctx.view.showSignatureNames) {
      const cport = ctx.source.findCPort(join.cportName);
      const mid = points[Math.floor(points.length / 2)];
      if (cport && mid) {
        const label = svgEl("text");
        setAttrs(label, { x: mid.x * k, y: mid.y * k - 3 });
        label.setAttribute("class", "signature-label");
        label.textContent = cport.signature;
        element.appendChild(label);
      }
    }
  }

  /**
   * ドラッグ中プレビュー: 既存 `<g>` の polyline の点列だけを仮の `bars` で描き直す
   * （5.5節・[[TECSCDE内部仕様]] 6.6節: モデル・履歴には書き込まない、見た目だけの置換）。
   */
  previewBars(element: SVGGElement, join: Join, ctx: JoinRenderContext, bars: readonly Bar[]): void {
    const line = element.querySelector<SVGPolylineElement>("polyline.join-line");
    const points = joinPolyline(join, ctx.source, ctx.target, bars);
    if (!line || !points) return;
    line.setAttribute("points", pointsAttr(points, pxPerMm(ctx.view)));
  }
}

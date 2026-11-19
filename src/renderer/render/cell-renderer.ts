// [[TECSCDE-DT-EL内部仕様]] 第5章5.1節 — セル1個の `<g>` を描く `CellRenderer`。
// 矩形・セル名／セルタイプ名ラベル・呼び口／受け口の三角記号を子要素として持つ。
// 選択の強調表示は `#selection-overlay`（最前面の別レイヤ）が担うため、ここでは描かない
// （[[TECSCDE内部仕様]] 6.1節のSVGツリー構造）。

import { ElementRenderer, setAttrs, svgEl } from "./element-renderer";
import { pxPerMm, type CanvasView } from "./view";
import type { Cell } from "../model/cell";
import type { EdgeSide, Port } from "../model/port";
import { portPosition } from "../model/geometry";
import { styleSearchHighlight } from "./search-highlights";
import { isActiveCell } from "../model/active-cell";
import { deriveCellVisualState } from "./cell-visual-state";
import type { TecscdeDocument } from "../model/document";

export interface CellRenderContext {
  readonly view: CanvasView;
  readonly searchMatch?: boolean;
  readonly doc?: TecscdeDocument;
}

/** リージョンの色の帯の幅(mm)。第6B章6B.5（暫定値）。 */
export const REGION_TAB_MM = 2;

/** 外部仕様4.3.2・三者相違一覧3-11（監査#57）: ポート三角記号の底辺 3 mm・高さ 2.598 mm。 */
export const PORT_TRIANGLE_LEN_MM = 3;
export const PORT_TRIANGLE_HEIGHT_MM = 2.598;

/**
 * 辺とポート種別（呼び口/受け口）に応じた三角形の頂点列を返す。
 * 呼び口（cport）はセルの外向き、受け口（eport）はセルの内向きとし、色のみに依存せず区別する。
 * 寸法は mm 単位に `k`（MM_TO_PX * zoom）を掛けてズームに追従させる。
 */
export function portSymbolPoints(edge: EdgeSide, kind: "cport" | "eport", k: number): string {
  const half = (PORT_TRIANGLE_LEN_MM * k) / 2;
  const h = PORT_TRIANGLE_HEIGHT_MM * k;
  // outward: +1 はセル外向き（呼び口）、-1 はセル内向き（受け口）
  const dir = kind === "cport" ? 1 : -1;
  switch (edge) {
    case "LEFT":
      return `0,${-half} ${-h * dir},0 0,${half}`;
    case "RIGHT":
      return `0,${-half} ${h * dir},0 0,${half}`;
    case "TOP":
      return `${-half},0 0,${-h * dir} ${half},0`;
    case "BOTTOM":
      return `${-half},0 0,${h * dir} ${half},0`;
  }
}

export class CellRenderer extends ElementRenderer<Cell, CellRenderContext> {
  override createElement(cell: Cell, ctx: CellRenderContext): SVGGElement {
    const group = svgEl("g");
    group.dataset["cellId"] = cell.id;
    this.updateElement(cell, group, ctx);
    return group;
  }

  override updateElement(cell: Cell, element: SVGGElement, ctx: CellRenderContext): void {
    const k = pxPerMm(ctx.view);
    const x = cell.x * k;
    const y = cell.y * k;
    const w = cell.width * k;
    const h = cell.height * k;

    element.replaceChildren();

    if (ctx.searchMatch) {
      const highlight = svgEl("rect");
      const margin = 0.8 * k;
      setAttrs(highlight, { x: x - margin, y: y - margin, width: w + 2 * margin, height: h + 2 * margin });
      styleSearchHighlight(highlight, "cell");
      element.appendChild(highlight);
    }

    const rect = svgEl("rect");
    setAttrs(rect, { x, y, width: w, height: h });
    const classes = ["cell-rect"];
    if (ctx.doc && isActiveCell(ctx.doc, cell)) classes.push("active");
    if (!cell.editable) classes.push("readonly");
    if (cell.systemDefined) classes.push("system-defined");
    if (cell.celltypeUnresolved) classes.push("unresolved");
    rect.setAttribute("class", classes.join(" "));
    element.appendChild(rect);

    // 第6B章6B.5: 色分け表示のリージョンの色は、状態を表す塗り・枠とは別に左端の帯で示す。
    const regionColor = ctx.view.regionBands === false ? undefined : ctx.view.regionColors?.get(cell.regionId);
    if (regionColor !== undefined) {
      const tab = svgEl("rect");
      setAttrs(tab, { x, y, width: Math.min(REGION_TAB_MM * k, w), height: h });
      tab.setAttribute("class", "region-tab");
      tab.setAttribute("fill", regionColor);
      element.appendChild(tab);
    }

    const nameLabel = svgEl("text");
    setAttrs(nameLabel, { x: x + w / 2, y: y + h / 2 - 3 });
    nameLabel.setAttribute("text-anchor", "middle");
    // 外部仕様7.4.2: セル名強調がオンなら、セル名を大きくセルの中央に置き、セルタイプ名は描かない。
    const emphasized = ctx.view.emphasizeCellName;
    nameLabel.setAttribute("class", emphasized ? "cell-label emphasized" : "cell-label");
    if (emphasized) {
      nameLabel.setAttribute("dominant-baseline", "middle");
      setAttrs(nameLabel, { x: x + w / 2, y: y + h / 2 });
    }
    nameLabel.textContent = cell.name;
    element.appendChild(nameLabel);

    if (!emphasized) {
      const typeLabel = svgEl("text");
      setAttrs(typeLabel, { x: x + w / 2, y: y + h / 2 + 9 });
      typeLabel.setAttribute("text-anchor", "middle");
      typeLabel.setAttribute("class", "celltype-label");
      typeLabel.textContent = cell.celltypeName;
      element.appendChild(typeLabel);
    }

    this.appendStatusBadges(element, cell, ctx, x, y, w, h);

    for (const port of cell.cports) this.appendPortSymbol(element, cell, port, "cport", k);
    for (const port of cell.eports) this.appendPortSymbol(element, cell, port, "eport", k);
  }

  private appendStatusBadges(
    parent: SVGGElement,
    cell: Cell,
    ctx: CellRenderContext,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!ctx.doc) return;
    const state = deriveCellVisualState(ctx.doc, cell);
    const badges: Array<{ kind: "ro" | "incomplete" | "u"; label: string }> = [];
    if (state.readOnly) badges.push({ kind: "ro", label: "RO" });
    if (state.incompleteReasons.length > 0) badges.push({ kind: "incomplete", label: "!" });
    if (state.unconnectedCallPortIds !== null && state.unconnectedCallPortIds.length > 0) {
      badges.push({ kind: "u", label: "U" });
    }
    if (badges.length === 0) return;

    const g = svgEl("g");
    g.setAttribute("class", "cell-status-badges");
    g.style.pointerEvents = "none";

    const badgeW = 12;
    const badgeH = 10;
    const gap = 3;
    const totalW = badges.length * badgeW + (badges.length - 1) * gap;
    let startX = x + (w - totalW) / 2;
    const badgeY = y + h - badgeH - 3;

    for (const b of badges) {
      const bg = svgEl("g");
      bg.setAttribute("class", `badge-${b.kind}`);
      if (b.kind === "ro") {
        const r = svgEl("rect");
        setAttrs(r, { x: startX, y: badgeY, width: badgeW, height: badgeH, rx: 1 });
        r.setAttribute("fill", "#ffffff");
        r.setAttribute("stroke", "#333333");
        r.setAttribute("stroke-width", "1");
        const t = svgEl("text");
        setAttrs(t, { x: startX + badgeW / 2, y: badgeY + badgeH / 2 + 1 });
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("font-size", "7");
        t.setAttribute("font-weight", "bold");
        t.setAttribute("fill", "#333333");
        t.textContent = "RO";
        bg.append(r, t);
      } else if (b.kind === "incomplete") {
        const poly = svgEl("polygon");
        const x1 = startX + badgeW / 2;
        const y1 = badgeY;
        const x2 = startX;
        const y2 = badgeY + badgeH;
        const x3 = startX + badgeW;
        const y3 = badgeY + badgeH;
        poly.setAttribute("points", `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
        poly.setAttribute("fill", "#ffffff");
        poly.setAttribute("stroke", "#333333");
        poly.setAttribute("stroke-width", "1");
        const t = svgEl("text");
        setAttrs(t, { x: startX + badgeW / 2, y: badgeY + badgeH / 2 + 2 });
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("font-size", "8");
        t.setAttribute("font-weight", "bold");
        t.setAttribute("fill", "#e65100");
        t.textContent = "!";
        bg.append(poly, t);
      } else if (b.kind === "u") {
        const c = svgEl("circle");
        const r = badgeH / 2;
        setAttrs(c, { cx: startX + badgeW / 2, cy: badgeY + r, r });
        c.setAttribute("fill", "#ffffff");
        c.setAttribute("stroke", "#333333");
        c.setAttribute("stroke-width", "1");
        const t = svgEl("text");
        setAttrs(t, { x: startX + badgeW / 2, y: badgeY + r + 1 });
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("font-size", "7");
        t.setAttribute("font-weight", "bold");
        t.setAttribute("fill", "#333333");
        t.textContent = "U";
        bg.append(c, t);
      }
      g.appendChild(bg);
      startX += badgeW + gap;
    }
    parent.appendChild(g);
  }

  private appendPortSymbol(
    parent: SVGGElement,
    cell: Cell,
    port: Port,
    kind: "cport" | "eport",
    k: number,
  ): void {
    const pos = portPosition(cell, port);
    const g = svgEl("g");
    g.setAttribute("transform", `translate(${pos.x * k}, ${pos.y * k})`);
    g.dataset["cellId"] = cell.id;
    g.dataset["portKind"] = kind;
    g.dataset["portName"] = port.name;
    if (port.subscript !== null) g.dataset["portSubscript"] = String(port.subscript);

    const tri = svgEl("polygon");
    tri.setAttribute("points", portSymbolPoints(port.edgeSide, kind, k));
    tri.setAttribute("class", `port-symbol port-symbol-${kind}`);
    g.appendChild(tri);
    parent.appendChild(g);
  }
}

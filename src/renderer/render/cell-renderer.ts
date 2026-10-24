// [[TECSCDE-DT-EL内部仕様]] 第5章5.1節 — セル1個の `<g>` を描く `CellRenderer`。
// 矩形・セル名／セルタイプ名ラベル・呼び口／受け口の三角記号を子要素として持つ。
// 選択の強調表示は `#selection-overlay`（最前面の別レイヤ）が担うため、ここでは描かない
// （[[TECSCDE内部仕様]] 6.1節のSVGツリー構造）。

import { ElementRenderer, setAttrs, svgEl } from "./element-renderer";
import { pxPerMm, type CanvasView } from "./view";
import type { Cell } from "../model/cell";
import type { EdgeSide, Port } from "../model/port";
import { portPosition } from "../model/geometry";

export interface CellRenderContext {
  readonly view: CanvasView;
}

/** リージョンの色の帯の幅(mm)。第6B章6B.5（暫定値）。 */
export const REGION_TAB_MM = 2;

/** 三角記号の1辺の長さ(px)。外部仕様4.3.1 Triangle_Len/Height相当を簡略化。 */
const PORT_SYMBOL_PX = 4;

/** 辺の向きに応じた三角形の頂点列（呼び口/受け口の左右を向きで区別する）。 */
function portSymbolPoints(edge: EdgeSide, size: number): string {
  switch (edge) {
    case "LEFT":
      return `0,${-size} ${size * 1.2},0 0,${size}`;
    case "RIGHT":
      return `0,${-size} ${-size * 1.2},0 0,${size}`;
    case "TOP":
      return `${-size},0 0,${size * 1.2} ${size},0`;
    case "BOTTOM":
      return `${-size},0 0,${-size * 1.2} ${size},0`;
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

    const rect = svgEl("rect");
    setAttrs(rect, { x, y, width: w, height: h });
    const classes = ["cell-rect"];
    if (!cell.editable) classes.push("readonly");
    if (cell.systemDefined) classes.push("system-defined");
    if (cell.celltypeUnresolved) classes.push("unresolved");
    rect.setAttribute("class", classes.join(" "));
    element.appendChild(rect);

    // 第6B章6B.5: 色分け表示のリージョンの色は、状態を表す塗り・枠とは別に左端の帯で示す。
    const regionColor = ctx.view.regionColors?.get(cell.regionId);
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

    for (const port of cell.cports) this.appendPortSymbol(element, cell, port, "cport", k);
    for (const port of cell.eports) this.appendPortSymbol(element, cell, port, "eport", k);
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
    tri.setAttribute("points", portSymbolPoints(port.edgeSide, PORT_SYMBOL_PX));
    tri.setAttribute("class", `port-symbol port-symbol-${kind}`);
    g.appendChild(tri);
    parent.appendChild(g);
  }
}

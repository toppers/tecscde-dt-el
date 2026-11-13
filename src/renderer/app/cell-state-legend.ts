import { appendStateBadge } from "../render/cell-state-display";

/** Fixed state legend, independent of region coloring and current selection. */
export class CellStateLegendView {
  private rendered = false;
  constructor(private readonly root: HTMLElement) {}
  render(): void {
    if (this.rendered) return;
    this.rendered = true;
    const doc = this.root.ownerDocument;
    const heading = doc.createElement("h3"); heading.textContent = "セルの状態";
    this.root.replaceChildren(heading);
    for (const [state, label] of [["readonly", "編集不可"], ["incomplete", "不完全"], ["unconnected", "未結合の呼び口あり"]] as const) {
      const row = doc.createElement("div"); row.className = "cell-state-legend-item";
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "32"); svg.setAttribute("height", "20"); svg.setAttribute("viewBox", "0 0 32 20");
      svg.setAttribute("aria-hidden", "true");
      appendStateBadge(svg, state, 3, 3, state === "readonly" ? 26 : 16, 14);
      const text = doc.createElement("span"); text.textContent = label;
      row.append(svg, text); this.root.append(row);
    }
  }
}

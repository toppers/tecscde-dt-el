// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.6 — 色分け表示の凡例。
// 色分けがオンの間、キャンバス左下に「色見本＋リージョン名」を重ねて表示する（外部仕様4.9.2・7.5.2）。
// 非表示のリージョン（親が非表示の子孫を含む）は載せない。色は描画層と同じ `CanvasView.regionColors`
// から読むので、セルの帯と必ず一致する。

import type { AppStore } from "./store";
import { ROOT_REGION_ID } from "../model/ids";
import type { Region } from "../model/region";

function collect(region: Region, out: Region[]): void {
  if (region.id !== ROOT_REGION_ID) out.push(region);
  for (const child of region.children) collect(child, out);
}

export class RegionLegendView {
  private lastSignature = "";

  constructor(private readonly root: HTMLElement, private readonly store: AppStore) {}

  render(): void {
    const doc = this.store.getDocument();
    const view = this.store.view.toCanvasView(doc.regions);
    const colors = view.regionColors;

    const regions: Region[] = [];
    collect(doc.regions.root, regions);
    const entries = colors
      ? regions
          .filter((r) => !view.hiddenRegionIds.has(r.id) && colors.has(r.id))
          .map((r) => ({ id: r.id, label: r.namespacePath, color: colors.get(r.id) as string }))
      : [];

    this.root.hidden = entries.length === 0;
    const signature = entries.map((e) => `${e.id}|${e.label}|${e.color}`).join("\n");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.root.replaceChildren();
    const d = this.root.ownerDocument;
    for (const entry of entries) {
      const item = d.createElement("div");
      item.className = "legend-item";
      item.dataset["regionId"] = entry.id;
      const swatch = d.createElement("span");
      swatch.className = "region-swatch";
      swatch.style.background = entry.color;
      const text = d.createElement("span");
      text.textContent = entry.label;
      item.append(swatch, text);
      this.root.appendChild(item);
    }
  }
}

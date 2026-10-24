// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.6 — 表示制御バーの「リージョン」ボタンと
// リージョン木のポップオーバー。各節点のチェックを外すとそのリージョンと子孫のセルを非表示にする
// （外部仕様7.5.2。ネームスペースはリージョンIDそのものなので、同じ木で扱う）。
//
// 状態は `AppStore.view.filters`（`hiddenRegions`）だけが持つ。本クラスは描画と入力の結線のみで、
// 木の構造が変わらない限りチェックボックスのDOMを作り直さない（操作直後にフォーカスを失わないため）。

import type { AppStore } from "./store";
import { ROOT_REGION_ID, type RegionId } from "../model/ids";
import type { Region } from "../model/region";
import { regionColor } from "../view-state/region-colors";

interface Row {
  readonly id: RegionId;
  readonly depth: number;
  readonly label: string;
  readonly cellCount: number;
  /** 祖先に、利用者が非表示にしたリージョンがあるか（あれば操作できない、6B.2）。 */
  readonly ancestorHidden: boolean;
}

/** 根を除く全リージョンを、木の順（深さ優先）の行にする。 */
function collectRows(root: Region, hiddenRegions: ReadonlySet<RegionId>): Row[] {
  const rows: Row[] = [];
  const visit = (region: Region, depth: number, ancestorHidden: boolean): void => {
    const isRoot = region.id === ROOT_REGION_ID;
    if (!isRoot) {
      const parts = region.namespacePath.split("::");
      rows.push({
        id: region.id,
        depth,
        label: parts[parts.length - 1] || region.namespacePath,
        cellCount: region.cellIds.length,
        ancestorHidden,
      });
    }
    const hiddenHere = ancestorHidden || (!isRoot && hiddenRegions.has(region.id));
    for (const child of region.children) visit(child, isRoot ? 0 : depth + 1, hiddenHere);
  };
  visit(root, 0, false);
  return rows;
}

export class RegionFilterPanel {
  private readonly toggleBtn: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly showAllBtn: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly checkboxes = new Map<RegionId, HTMLInputElement>();
  private readonly swatches = new Map<RegionId, HTMLElement>();
  private structureSignature = "";
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly root: HTMLElement, private readonly store: AppStore) {
    this.toggleBtn = this.requireEl("#region-filter-toggle");
    this.popover = this.requireEl("#region-filter-popover");

    this.showAllBtn = this.popover.ownerDocument.createElement("button");
    this.showAllBtn.type = "button";
    this.showAllBtn.dataset["role"] = "show-all";
    this.showAllBtn.textContent = "すべて表示";
    this.list = this.popover.ownerDocument.createElement("div");
    this.list.className = "region-filter-list";
    this.popover.append(this.showAllBtn, this.list);

    const onToggle = (): void => {
      this.popover.hidden = !this.popover.hidden;
      this.render();
    };
    const onShowAll = (): void => {
      this.store.setView(this.store.view.withFilters(this.store.view.filters.withAllRegionsShown()));
    };
    const onChange = (e: Event): void => {
      const input = e.target as HTMLInputElement | null;
      const id = input?.dataset["regionId"];
      if (!input || id === undefined) return;
      const filters = this.store.view.filters;
      this.store.setView(this.store.view.withFilters(filters.withRegionHidden(id as RegionId, !input.checked)));
    };
    this.toggleBtn.addEventListener("click", onToggle);
    this.showAllBtn.addEventListener("click", onShowAll);
    this.list.addEventListener("change", onChange);

    const doc = this.popover.ownerDocument;
    const onOutside = (e: Event): void => {
      if (this.popover.hidden) return;
      if (this.root.contains(e.target as Node | null)) return;
      this.close();
    };
    const onKey = (e: Event): void => {
      if ((e as KeyboardEvent).key === "Escape" && !this.popover.hidden) this.close();
    };
    doc.addEventListener("mousedown", onOutside);
    doc.addEventListener("keydown", onKey);

    this.disposers.push(
      () => this.toggleBtn.removeEventListener("click", onToggle),
      () => this.showAllBtn.removeEventListener("click", onShowAll),
      () => this.list.removeEventListener("change", onChange),
      () => doc.removeEventListener("mousedown", onOutside),
      () => doc.removeEventListener("keydown", onKey),
    );
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  private requireEl<T extends Element>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`RegionFilterPanel: 要素が見つかりません: ${selector}`);
    return el;
  }

  private close(): void {
    this.popover.hidden = true;
    this.toggleBtn.setAttribute("aria-expanded", "false");
  }

  render(): void {
    const doc = this.store.getDocument();
    const filters = this.store.view.filters;
    const rows = collectRows(doc.regions.root, filters.hiddenRegions);

    // 木に存在するリージョンのうち、利用者が外したものの数（取り残しのIDは数えない）。
    const hiddenCount = rows.filter((r) => filters.hiddenRegions.has(r.id)).length;
    this.toggleBtn.textContent = hiddenCount > 0 ? `リージョン（${hiddenCount}件非表示）` : "リージョン";
    this.toggleBtn.disabled = rows.length === 0;
    if (rows.length === 0) this.close();
    this.toggleBtn.setAttribute("aria-expanded", String(!this.popover.hidden));
    if (this.popover.hidden) return;

    this.showAllBtn.disabled = hiddenCount === 0;
    const signature = rows.map((r) => `${r.id}|${r.depth}|${r.label}|${r.cellCount}`).join("\n");
    if (signature !== this.structureSignature) {
      this.structureSignature = signature;
      this.rebuildList(rows);
    }
    this.syncRows(rows, filters.colorByRegion);
  }

  private rebuildList(rows: readonly Row[]): void {
    this.list.replaceChildren();
    this.checkboxes.clear();
    this.swatches.clear();
    const d = this.popover.ownerDocument;
    for (const row of rows) {
      const label = d.createElement("label");
      label.className = "region-filter-row";
      label.style.paddingLeft = `${row.depth * 14}px`;
      const input = d.createElement("input");
      input.type = "checkbox";
      input.dataset["regionId"] = row.id;
      const swatch = d.createElement("span");
      swatch.className = "region-swatch";
      const text = d.createElement("span");
      text.textContent = `${row.label} (${row.cellCount})`;
      label.append(input, text);
      this.list.appendChild(label);
      this.checkboxes.set(row.id, input);
      this.swatches.set(row.id, swatch);
    }
  }

  /** 構造が同じ間は、チェック・無効・色見本だけを状態に合わせる。色見本は色分けがオンの間だけ置く。 */
  private syncRows(rows: readonly Row[], colorOn: boolean): void {
    const hidden = this.store.view.filters.hiddenRegions;
    for (const row of rows) {
      const input = this.checkboxes.get(row.id);
      const swatch = this.swatches.get(row.id);
      if (!input || !swatch) continue;
      input.checked = !(row.ancestorHidden || hidden.has(row.id));
      input.disabled = row.ancestorHidden;
      const color = colorOn ? regionColor(row.id) : undefined;
      if (color === undefined) {
        swatch.remove();
      } else {
        swatch.style.background = color;
        if (!swatch.isConnected) input.after(swatch);
      }
    }
  }
}

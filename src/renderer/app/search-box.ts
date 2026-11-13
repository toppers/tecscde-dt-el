// DT-EL internal spec 6.4: list and cycle through the search snapshot from AppShell.
// Jumping to hidden hits reveals their regions (6B.8).

import { cellsForSearchHit, regionsToReveal, type SearchHit } from "../view-state/search";
import { isActiveCell } from "../render/cell-visibility";
import { SelectionState } from "../render/view";
import type { AppStore } from "./store";

export class SearchBoxView {
  private readonly input: HTMLInputElement;
  private readonly countEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private hits: readonly SearchHit[] = [];
  private cursor = -1;
  private readonly revealedHits = new Set<string>();
  private lastQuery: string | null = null;
  private lastEpoch = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
  ) {
    this.input = this.requireEl<HTMLInputElement>("#search-input");
    this.countEl = this.requireEl("#search-count");
    this.resultsEl = this.requireEl("#search-results");

    this.input.addEventListener("input", () => {
      this.store.setView(this.store.view.withSearchQuery(this.input.value));
    });
    this.resultsEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const indexAttr = target?.closest<HTMLElement>("[data-hit-index]")?.dataset["hitIndex"];
      if (indexAttr === undefined) return;
      this.jumpTo(Number(indexAttr));
    });
  }

  private requireEl<T extends Element>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`SearchBoxView: 要素が見つかりません: ${selector}`);
    return el;
  }

  render(hits: readonly SearchHit[]): void {
    const view = this.store.view;
    if (this.lastQuery !== view.searchQuery || this.lastEpoch !== this.store.documentEpoch) {
      this.revealedHits.clear();
      this.lastQuery = view.searchQuery;
      this.lastEpoch = this.store.documentEpoch;
    }
    if (this.input.value !== (view.searchQuery ?? "")) {
      this.input.value = view.searchQuery ?? "";
    }
    const present = new Set(hits.map((hit) => this.hitKey(hit)));
    for (const key of this.revealedHits) if (!present.has(key)) this.revealedHits.delete(key);
    this.hits = hits.map((hit) => this.revealedHits.has(this.hitKey(hit)) ? { ...hit, revealed: true } : hit);
    if (this.cursor >= this.hits.length) this.cursor = this.hits.length > 0 ? 0 : -1;

    this.countEl.textContent = view.searchQuery ? `${this.hits.length}件` : "";
    this.renderResults();
  }

  private hitKey(hit: SearchHit): string { return hit.kind + ":" + (hit.kind === "cell" ? hit.cellId : hit.joinId); }

  private renderResults(): void {
    this.resultsEl.replaceChildren();
    this.hits.forEach((hit, i) => {
      const item = document.createElement("div");
      item.className = "search-hit" + (hit.revealed ? " revealed" : "") + (i === this.cursor ? " current" : "");
      item.dataset["hitIndex"] = String(i);
      item.textContent = hit.label;
      this.resultsEl.appendChild(item);
    });
  }

  /** 次ヒットへジャンプ（末尾からは先頭へ巡回）。ヒットが無ければ何もしない。 */
  next(): void {
    if (this.hits.length === 0) return;
    this.jumpTo((this.cursor + 1 + this.hits.length) % this.hits.length);
  }

  /** 前ヒットへジャンプ（先頭からは末尾へ巡回）。ヒットが無ければ何もしない。 */
  prev(): void {
    if (this.hits.length === 0) return;
    this.jumpTo((this.cursor - 1 + this.hits.length) % this.hits.length);
  }

  private jumpTo(index: number): void {
    const hit = this.hits[index];
    if (!hit) return;
    this.cursor = index;
    const doc = this.store.getDocument();
    // 第6B章6B.8（外部仕様7.4.2）: 非表示のリージョンにあるヒットは、見えるようフィルタを緩める。
    // 緩めた分は元に戻さない（利用者がリージョン木で再び外す）。変化が無ければ同じ参照が返り何も起きない。
    const filters = this.store.view.filters;
    let revealedFilters = filters.withRegionsRevealed(regionsToReveal(doc, hit));
    if (filters.activeOnly && cellsForSearchHit(doc, hit).some((cell) => !isActiveCell(doc, cell))) {
      revealedFilters = revealedFilters.withActiveOnly(false);
    }
    if (!filters.equals(revealedFilters)) this.revealedHits.add(this.hitKey(hit));
    this.store.setView(this.store.view.withFilters(revealedFilters));
    if (hit.kind === "cell") {
      const cell = doc.getCell(hit.cellId);
      this.store.setSelection(SelectionState.ofCells([hit.cellId]));
      if (cell) this.panTo(cell.x + cell.width / 2, cell.y + cell.height / 2);
    } else {
      const join = doc.getJoin(hit.joinId);
      this.store.setSelection(SelectionState.ofJoin(hit.joinId));
      const source = join ? doc.getCell(join.cellId) : undefined;
      if (source) this.panTo(source.x + source.width / 2, source.y + source.height / 2);
    }
    this.renderResults();
  }

  private panTo(x: number, y: number): void {
    this.store.setView(this.store.view.panTo({ x, y }));
  }
}

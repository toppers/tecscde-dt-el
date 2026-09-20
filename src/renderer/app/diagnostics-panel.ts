// [[TECSCDE-DT-EL内部仕様]] 第8章8.4節・第2章2.3節「G: UIシェル」— 診断パネル（モジュールG次段）。
// `AppStore.getReport()`（B・H・Iの集約結果）を一覧表示する。`relatedCellId`/`relatedJoinId`を
// 持つ診断は第6章6.4節の検索ジャンプ機構と同じ操作（選択＋パン）にそのまま渡し、専用の
// ハイライト表現は新設しない（8.4節）。`location`のみの診断（CDL解析エラー等）は図要素への
// ジャンプ先が無いため、テキスト位置の提示に留める（同節）。

import type { Diagnostic } from "../diagnostics/types";
import { SelectionState } from "../render/view";
import type { AppStore } from "./store";

export class DiagnosticsPanelView {
  private visible = false;

  constructor(
    private readonly toggleEl: HTMLButtonElement,
    private readonly panelEl: HTMLElement,
    private readonly store: AppStore,
  ) {
    this.toggleEl.addEventListener("click", () => this.toggle());
    this.panelEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const indexAttr = target?.closest<HTMLElement>("[data-diag-index]")?.dataset["diagIndex"];
      if (indexAttr === undefined) return;
      this.jumpTo(Number(indexAttr));
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.render();
  }

  /**
   * Generateなど、明示的な操作の直後に結果を必ず見せる（実機確認で判明: ステータスバーの
   * 件数表示だけでは、それが直前の操作の結果だと人間には認識できなかった、2026-09-20）。
   * 診断が無ければ`render()`側の`hidden`判定（`report.isEmpty`）で結局非表示のままになる。
   */
  open(): void {
    if (!this.visible) {
      this.visible = true;
      this.render();
    }
  }

  render(): void {
    const report = this.store.getReport();
    this.toggleEl.textContent = report.isEmpty ? "" : `⚠ ${report.errorCount} エラー / ${report.warningCount} 警告`;
    this.toggleEl.disabled = report.isEmpty;

    const hidden = !this.visible || report.isEmpty;
    this.panelEl.hidden = hidden;
    if (hidden) return;

    this.panelEl.replaceChildren();
    report.items.forEach((d, i) => {
      const item = document.createElement("div");
      item.className = `diag-item diag-${d.severity}`;
      if (this.jumpTarget(d)) {
        item.classList.add("diag-jumpable");
        item.dataset["diagIndex"] = String(i);
      }
      item.textContent = this.formatDiagnostic(d);
      this.panelEl.appendChild(item);
    });
  }

  private jumpTarget(d: Diagnostic): boolean {
    return d.relatedCellId !== undefined || d.relatedJoinId !== undefined;
  }

  private formatDiagnostic(d: Diagnostic): string {
    const loc = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}: ` : "";
    return `[${d.code}] ${loc}${d.message}`;
  }

  private jumpTo(index: number): void {
    const d = this.store.getReport().items[index];
    if (!d) return;
    const doc = this.store.getDocument();
    if (d.relatedCellId !== undefined) {
      const cell = doc.getCell(d.relatedCellId);
      this.store.setSelection(SelectionState.ofCells([d.relatedCellId]));
      if (cell) this.panTo(cell.x + cell.width / 2, cell.y + cell.height / 2);
      return;
    }
    if (d.relatedJoinId !== undefined) {
      const join = doc.getJoin(d.relatedJoinId);
      this.store.setSelection(SelectionState.ofJoin(d.relatedJoinId));
      const source = join ? doc.getCell(join.cellId) : undefined;
      if (source) this.panTo(source.x + source.width / 2, source.y + source.height / 2);
    }
  }

  private panTo(x: number, y: number): void {
    this.store.setView(this.store.view.panTo({ x, y }));
  }
}

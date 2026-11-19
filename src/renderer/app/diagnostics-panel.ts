// [[TECSCDE-DT-EL内部仕様]] 第8章8.4節・8.7節・外部仕様9.6 — 診断パネル（モジュールG次段）。
// `AppStore.getReport()`（B・H・Iの集約結果）を「種別・該当箇所・メッセージ・操作」の4列表で表示する（三者相違一覧2-19・監査#52）。
// `relatedCellId`/`relatedJoinId`を持つ診断は第6章6.4節の検索ジャンプ機構と同じ操作（選択＋パン）にそのまま渡す。
// 図要素が無くても該当行・列へ移るソースジャンプは[[TECSCDE-DT-EL内部仕様 - 08B 診断位置へのソースジャンプ|8B]]で設計済みだが未実装（V0.4.0、三者相違一覧 8-12・9-7）。

import type { Diagnostic } from "../diagnostics/types";
import { SelectionState } from "../render/view";
import type { AppStore } from "./store";

function formatLocationColumn(d: Diagnostic): string {
  if (d.location) {
    const file = d.location.file ? `${d.location.file}:` : "";
    return `${file}${d.location.line}:${d.location.column}`;
  }
  if (d.relatedCellId !== undefined) return String(d.relatedCellId);
  if (d.relatedJoinId !== undefined) return String(d.relatedJoinId);
  return "—";
}

function formatSeverityColumn(d: Diagnostic): string {
  const kind = d.severity === "error" ? "エラー" : "警告";
  return d.code ? `${kind} [${d.code}]` : kind;
}

export class DiagnosticsPanelView {
  private visible = false;
  private previousCount = 0;

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
    if (report.items.length > this.previousCount) this.visible = true;
    this.previousCount = report.items.length;
    this.toggleEl.textContent = report.isEmpty ? "" : `⚠ ${report.errorCount} エラー / ${report.warningCount} 警告`;
    this.toggleEl.disabled = report.isEmpty;

    const hidden = !this.visible || report.isEmpty;
    this.panelEl.hidden = hidden;
    if (hidden) return;

    this.panelEl.replaceChildren();
    const table = document.createElement("table");
    table.className = "diag-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["種別", "該当箇所", "メッセージ", "操作"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    report.items.forEach((d, i) => {
      const row = document.createElement("tr");
      row.className = `diag-item diag-${d.severity}`;
      const jumpable = this.jumpTarget(d);
      if (jumpable) {
        row.classList.add("diag-jumpable");
        row.dataset["diagIndex"] = String(i);
      }

      const tdKind = document.createElement("td");
      tdKind.className = "diag-col-kind";
      tdKind.textContent = formatSeverityColumn(d);

      const tdLoc = document.createElement("td");
      tdLoc.className = "diag-col-location";
      tdLoc.textContent = formatLocationColumn(d);

      const tdMsg = document.createElement("td");
      tdMsg.className = "diag-col-message";
      tdMsg.textContent = d.message;

      const tdAction = document.createElement("td");
      tdAction.className = "diag-col-action";
      if (jumpable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "diag-jump-btn";
        btn.dataset["diagIndex"] = String(i);
        btn.textContent = "ジャンプ";
        tdAction.appendChild(btn);
      } else {
        tdAction.textContent = "—";
      }

      row.append(tdKind, tdLoc, tdMsg, tdAction);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    this.panelEl.appendChild(table);
    this.updateHeightLimit();
  }

  /** 折り返し行も1診断として、先頭10件の実際の高さ（ヘッダ・padding・罫線込み）まで表示する。 */
  updateHeightLimit(): void {
    if (this.panelEl.hidden) return;
    const theadHeight = this.panelEl.querySelector<HTMLElement>("thead")?.getBoundingClientRect().height ?? 0;
    const rows = Array.from(this.panelEl.querySelectorAll<HTMLElement>(".diag-item")).slice(0, 10);
    const height = theadHeight + rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
    if (height > 0) this.panelEl.style.maxHeight = `${height}px`;
  }

  private jumpTarget(d: Diagnostic): boolean {
    return d.relatedCellId !== undefined || d.relatedJoinId !== undefined;
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

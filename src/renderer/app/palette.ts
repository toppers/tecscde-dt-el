// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」モジュールG次段 — パレット（外部仕様3.3節）。
// セルタイプ一覧（クリックでセル新規作成モードへ切り替え、対象セルタイプを設定）と、
// 選択モードの排他トグル（外部仕様3.3.2: 「選択」「セル新規作成」のいずれか一方が常に選択）。
// 従来のツールバー上の`<select>`＋チェックボックスをこのパネルへ置き換える。

import type { AppStore } from "./store";
import type { TecscdeDocument } from "../model/document";

export class PaletteView {
  private readonly selectModeBtn: HTMLButtonElement;
  private readonly newCellModeBtn: HTMLButtonElement;
  private readonly celltypeList: HTMLElement;
  private lastCelltypeSignature = "";
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    onDetails: (name: string, trigger: HTMLElement) => void,
  ) {
    this.selectModeBtn = this.requireEl("[data-mode='select']");
    this.newCellModeBtn = this.requireEl("[data-mode='newCell']");
    this.celltypeList = this.requireEl("#palette-celltypes");

    const onSelect = (): void => this.store.setMode("select");
    const onNew = (): void => this.store.setMode("newCell");
    const onClick = (e: Event): void => {
      const target = e.target as HTMLElement | null;
      const details = target?.closest<HTMLElement>("[data-celltype-details]");
      const detailsName = details?.dataset["celltypeDetails"];
      if (details && detailsName) { onDetails(detailsName, details); return; }
      const name = target?.closest<HTMLElement>("[data-celltype]")?.dataset["celltype"];
      if (!name) return;
      this.store.setActiveCelltype(name);
      this.store.setMode("newCell");
    };
    this.selectModeBtn.addEventListener("click", onSelect);
    this.newCellModeBtn.addEventListener("click", onNew);
    this.celltypeList.addEventListener("click", onClick);
    this.disposers.push(() => {
      this.selectModeBtn.removeEventListener("click", onSelect);
      this.newCellModeBtn.removeEventListener("click", onNew);
      this.celltypeList.removeEventListener("click", onClick);
    });
  }

  private requireEl<T extends Element>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`PaletteView: 要素が見つかりません: ${selector}`);
    return el;
  }

  render(): void {
    const mode = this.store.getMode();
    this.selectModeBtn.classList.toggle("active", mode === "select");
    this.selectModeBtn.setAttribute("aria-pressed", String(mode === "select"));
    this.newCellModeBtn.classList.toggle("active", mode === "newCell");
    this.newCellModeBtn.setAttribute("aria-pressed", String(mode === "newCell"));

    this.renderCelltypes(this.store.getDocument());
  }

  private renderCelltypes(doc: TecscdeDocument): void {
    const names = doc.celltypeValues().map((c) => c.name);
    const active = this.store.getActiveCelltypeName();

    // アクティブなセルタイプが未設定／解決不能なら先頭を設定する。setActiveCelltype()は
    // 同期的にnotify()し、この render() を再入させて完成させるため、ここで一旦抜ける
    // （抜けずに続けると、再入した呼び出しとこの呼び出しの両方がDOMへ追加し二重になる）。
    if (names.length > 0 && (!active || !names.includes(active))) {
      this.store.setActiveCelltype(names[0]);
      return;
    }
    // セルタイプが0件なら、前の文書のアクティブ名を残さない（残ると新規作成の案内が出ず、追加も無反応になる）。
    if (names.length === 0 && active) {
      this.store.setActiveCelltype(undefined);
      return;
    }

    const signature = `${names.join(",")}|${active ?? ""}`;
    if (signature === this.lastCelltypeSignature) return;
    this.lastCelltypeSignature = signature;

    this.celltypeList.replaceChildren();
    if (names.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "(セルタイプなし)";
      this.celltypeList.appendChild(empty);
      return;
    }
    for (const name of names) {
      const row = document.createElement("div");
      row.className = "palette-celltype-row";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "palette-celltype" + (name === active ? " active" : "");
      item.dataset["celltype"] = name;
      item.textContent = name;
      const details = document.createElement("button");
      details.type = "button";
      details.className = "palette-celltype-details";
      details.dataset["celltypeDetails"] = name;
      details.textContent = "詳細";
      details.setAttribute("aria-label", `${name}の詳細`);
      row.append(item, details);
      this.celltypeList.appendChild(row);
    }
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

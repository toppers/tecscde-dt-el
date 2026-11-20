// V0.3.1 段3 — 名前空間の凡例。
// キャンバス左下に、ドキュメント内で使用されている名前空間の一覧と「使用されたファイル」ボタンを表示する。

import type { AppStore } from "./store";

export class NamespaceLegendView {
  private lastSignature = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    private readonly onOpenDetails: (namespace: string) => void,
  ) {}

  render(): void {
    const doc = this.store.getDocument();
    const namespaces = Array.from(doc.namespaceFiles.keys()).sort(
      (a, b) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0),
    );
    const dotMode = this.store.view.filters.namespaceDisplay === "dot";

    this.root.hidden = namespaces.length === 0;
    const signature = `${dotMode ? "dot" : "show"}|${namespaces.join("\n")}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.root.replaceChildren();
    if (namespaces.length === 0) return;

    const d = this.root.ownerDocument;
    const title = d.createElement("div");
    title.className = "namespace-legend-title";
    title.textContent = dotMode ? "名前空間（● 代替中）" : "名前空間";
    this.root.appendChild(title);

    for (const ns of namespaces) {
      const row = d.createElement("div");
      row.className = "namespace-legend-item";
      row.dataset["namespace"] = ns;

      const label = d.createElement("span");
      label.className = "namespace-legend-name";
      label.textContent = dotMode ? `● ${ns}` : ns;

      const btn = d.createElement("button");
      btn.type = "button";
      btn.className = "namespace-files-btn";
      btn.dataset["namespaceFiles"] = ns;
      btn.textContent = "使用されたファイル";
      btn.addEventListener("click", () => this.onOpenDetails(ns));

      row.append(label, btn);
      this.root.appendChild(row);
    }
  }
}

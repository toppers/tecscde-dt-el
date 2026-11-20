// V0.3.1 段3 — 「名前空間詳細」ウィンドウ。
// 選択した名前空間を使用しているファイルのフルパスを一覧表示し、各行の「参照」ボタンから
// 既存の DefinitionFileView（「ファイル」ウィンドウ）を開く。

import type { AppStore } from "./store";
import { definitionLocation, type DefinitionSource } from "./definition-source";

export interface NamespaceDetailsViewOptions {
  readonly store: AppStore;
  readonly onShowFile: (source: DefinitionSource) => void;
  readonly document?: Document;
}

export class NamespaceDetailsView {
  private readonly dialog: HTMLDialogElement;
  private readonly heading: HTMLHeadingElement;
  private readonly list: HTMLDivElement;
  private currentNamespace: string | undefined;
  private disposed = false;

  constructor(private readonly options: NamespaceDetailsViewOptions) {
    const doc = options.document ?? document;
    this.dialog = doc.createElement("dialog");
    this.dialog.className = "namespace-details-dialog";
    this.dialog.setAttribute("aria-modal", "false");

    this.heading = doc.createElement("h2");
    this.list = doc.createElement("div");
    this.list.className = "namespace-details-list";

    const close = doc.createElement("button");
    close.type = "button";
    close.className = "namespace-details-close";
    close.textContent = "閉じる";
    close.addEventListener("click", () => this.close());

    this.dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        this.close();
      }
    });

    this.dialog.append(this.heading, this.list, close);
    doc.body.append(this.dialog);
  }

  get isOpen(): boolean {
    return !this.disposed && this.dialog.open;
  }

  open(namespace: string): void {
    if (this.disposed) return;
    this.currentNamespace = namespace;
    this.render();
    if (!this.dialog.open) this.dialog.show();
  }

  render(): void {
    if (this.disposed || !this.currentNamespace) return;
    const ns = this.currentNamespace;
    const doc = this.dialog.ownerDocument;
    this.heading.textContent = `名前空間詳細: ${ns}`;
    this.list.replaceChildren();

    const files = this.options.store.getDocument().namespaceFiles.get(ns) ?? [];
    if (files.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "namespace-details-empty";
      empty.textContent = "使用しているファイルはありません。";
      this.list.appendChild(empty);
      return;
    }

    const generatedSources = this.options.store.getGeneratedTypeSources();
    for (const file of files) {
      const location = definitionLocation(file.path, generatedSources, file.generated);
      const row = doc.createElement("div");
      row.className = "namespace-details-row";

      const pathEl = doc.createElement("span");
      pathEl.className = "namespace-details-path";
      pathEl.textContent = file.path;
      pathEl.style.overflowWrap = "anywhere";
      pathEl.style.userSelect = "text";

      const refBtn = doc.createElement("button");
      refBtn.type = "button";
      refBtn.className = "namespace-details-ref";
      refBtn.dataset["openNamespaceFile"] = file.path;
      refBtn.textContent = "参照";
      refBtn.disabled = !location.source;
      refBtn.addEventListener("click", () => {
        if (location.source) this.options.onShowFile(location.source);
      });

      row.append(pathEl, refBtn);
      this.list.appendChild(row);
    }
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.close();
    this.disposed = true;
    this.dialog.remove();
  }
}

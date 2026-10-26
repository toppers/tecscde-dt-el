// 外部仕様3.6.2・4.2.2: セルタイプ定義を参照するモーダル。型定義は編集しない。
import type { CelltypeRef, PortTemplate } from "../model/celltype";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function portSection(title: string, ports: readonly PortTemplate[]): HTMLElement {
  const section = element("section");
  section.append(element("h3", title));
  if (ports.length === 0) {
    section.append(element("p", "なし"));
    return section;
  }
  const table = element("table");
  const head = element("tr");
  for (const label of ["名前", "シグニチャ", "配列長"]) head.append(element("th", label));
  const thead = element("thead");
  thead.append(head);
  const body = element("tbody");
  for (const port of ports) {
    const row = element("tr");
    row.append(element("td", port.name), element("td", port.signature), element("td", port.arraySize === null ? "—" : String(port.arraySize)));
    body.append(row);
  }
  table.append(thead, body);
  section.append(table);
  return section;
}

export class CelltypeDetailsView {
  private readonly content: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private returnFocus: HTMLElement | undefined;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly dialog: HTMLDialogElement) {
    const content = dialog.querySelector<HTMLElement>(".celltype-details-content");
    const close = dialog.querySelector<HTMLButtonElement>(".celltype-details-close");
    const heading = dialog.querySelector<HTMLHeadingElement>("h2");
    if (!content || !close || !heading) throw new Error("CelltypeDetailsView: ダイアログの要素が見つかりません");
    this.content = content;
    this.heading = heading;
    heading.tabIndex = -1;
    const onClose = (): void => this.close();
    const onCancel = (event: Event): void => { event.preventDefault(); this.close(); };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
      // コピー等のブラウザ標準操作は残し、背後の編集ショートカットへ伝えない。
      event.stopPropagation();
    };
    const onWindowKey = (event: KeyboardEvent): void => {
      if (!dialog.open || (event.target instanceof Node && dialog.contains(event.target))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") this.close();
    };
    const window = dialog.ownerDocument.defaultView!;
    close.addEventListener("click", onClose);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onWindowKey, true);
    this.disposers.push(() => {
      close.removeEventListener("click", onClose);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onWindowKey, true);
    });
  }

  open(celltype: CelltypeRef, trigger: HTMLElement): void {
    this.returnFocus = trigger;
    const fields = element("dl");
    fields.append(element("dt", "セルタイプ"), element("dd", celltype.name), element("dt", "定義元"), element("dd", celltype.locale ?? "不明"));
    const attrs = element("section");
    attrs.append(element("h3", "属性"));
    if (celltype.attributeNames.length === 0) attrs.append(element("p", "なし"));
    else {
      const list = element("ul");
      for (const name of celltype.attributeNames) list.append(element("li", name));
      attrs.append(list);
    }
    this.content.replaceChildren(
      fields,
      element("p", "セルタイプの定義は読み取り専用です。"),
      portSection("呼び口", celltype.cportTemplates),
      portSection("受け口", celltype.eportTemplates),
      attrs,
    );
    if (!this.dialog.open) this.dialog.showModal();
    this.heading.focus();
  }

  private close(): void {
    if (this.dialog.open) this.dialog.close();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = undefined;
  }

  dispose(): void {
    this.close();
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

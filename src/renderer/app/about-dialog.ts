// 外部仕様3.8: バージョン情報のモーダル。項目の組み立ては about-info.ts、ここは表示と操作だけ。
// 作りは celltype-details.ts と同じ（<dialog>、Esc で閉じる、背後の編集ショートカットへ伝えない）。

import { buildAboutRows, formatAboutText, type AboutInput, type AboutRow } from "./about-info";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export class AboutDialogView {
  private readonly content: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private returnFocus: HTMLElement | undefined;
  private rows: readonly AboutRow[] = [];
  private readonly disposers: Array<() => void> = [];

  /**
   * @param getInput 開くたびに呼ぶ。tecsgen の確認は起動後に終わるので、開くときの最新の値を使う。
   * @param copyText 「コピー」で呼ぶ（クリップボードへの書き込み）。
   */
  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly getInput: () => AboutInput,
    private readonly copyText: (text: string) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {
    const content = dialog.querySelector<HTMLElement>(".about-content");
    const close = dialog.querySelector<HTMLButtonElement>(".about-close");
    const copy = dialog.querySelector<HTMLButtonElement>(".about-copy");
    const heading = dialog.querySelector<HTMLHeadingElement>("h2");
    if (!content || !close || !copy || !heading) throw new Error("AboutDialogView: ダイアログの要素が見つかりません");
    this.content = content;
    this.heading = heading;
    heading.tabIndex = -1;
    const onClose = (): void => this.close();
    const onCopy = (): void => {
      this.copyText(formatAboutText(this.rows)).catch(this.onError);
    };
    const onCancel = (event: Event): void => { event.preventDefault(); this.close(); };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
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
    copy.addEventListener("click", onCopy);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onWindowKey, true);
    this.disposers.push(() => {
      close.removeEventListener("click", onClose);
      copy.removeEventListener("click", onCopy);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onWindowKey, true);
    });
  }

  open(trigger: HTMLElement): void {
    this.returnFocus = trigger;
    this.rows = buildAboutRows(this.getInput());
    const list = element("dl");
    for (const row of this.rows) list.append(element("dt", row.label), element("dd", row.value));
    this.content.replaceChildren(list);
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

// 外部仕様3.1.2・DT外部仕様3.5.1: 領域の表示状態は文書・編集履歴と分けてDOMに保持する。
const PANEL_IDS = ["toolbar", "palette", "property-panel", "statusbar", "file-browser"] as const;

export class PanelVisibilityView {
  private readonly menu: HTMLDetailsElement;
  private readonly panels = new Map<string, HTMLElement>();
  private readonly disposers: Array<() => void> = [];

  constructor(root: ParentNode, onLayoutChanged: () => void) {
    const menu = root.querySelector<HTMLDetailsElement>("#panel-visibility");
    const summary = menu?.querySelector<HTMLElement>("summary");
    if (!menu || !summary) throw new Error("PanelVisibilityView: 表示メニューが見つかりません");
    this.menu = menu;
    for (const id of PANEL_IDS) {
      const panel = root.querySelector<HTMLElement>(`#${id}`);
      const input = menu.querySelector<HTMLInputElement>(`input[data-panel='${id}']`);
      if (!panel || !input) throw new Error(`PanelVisibilityView: ${id}が見つかりません`);
      this.panels.set(id, panel);
      input.checked = !panel.hidden;
    }

    const onChange = (event: Event): void => {
      const input = event.target as HTMLInputElement | null;
      const panel = this.panels.get(input?.dataset["panel"] ?? "");
      if (!panel || !input || panel.hidden === !input.checked) return;
      // 要素自体を保持するので、入力内容・サイドパネルの幅・ツリー展開は失われない。
      panel.hidden = !input.checked;
      onLayoutChanged();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !menu.open) return;
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      summary.focus();
    };
    const onOutside = (event: Event): void => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    };
    menu.addEventListener("change", onChange);
    menu.addEventListener("keydown", onKey);
    menu.ownerDocument.addEventListener("pointerdown", onOutside);
    this.disposers.push(() => {
      menu.removeEventListener("change", onChange);
      menu.removeEventListener("keydown", onKey);
      menu.ownerDocument.removeEventListener("pointerdown", onOutside);
    });
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.menu.open = false;
  }
}

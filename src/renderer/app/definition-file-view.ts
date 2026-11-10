import type { DefinitionSource } from "./definition-source";

export interface DefinitionFileViewOptions {
  readonly readFile: (path: string) => Promise<{ readonly path: string; readonly content: string }>;
  readonly document?: Document;
}

/** A read-only file view, independent of parsing, session state, and edit history. */
export class DefinitionFileView {
  private readonly dialog: HTMLDialogElement;
  private readonly heading: HTMLHeadingElement;
  private readonly origin: HTMLParagraphElement;
  private readonly error: HTMLParagraphElement;
  private readonly body: HTMLPreElement;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: DefinitionFileViewOptions) {
    const doc = options.document ?? document;
    this.dialog = doc.createElement("dialog");
    this.dialog.className = "definition-file-window";
    this.dialog.setAttribute("aria-modal", "false");
    this.heading = doc.createElement("h2");
    this.origin = doc.createElement("p");
    this.origin.className = "definition-file-origin";
    this.origin.style.overflowWrap = "anywhere";
    this.error = doc.createElement("p");
    this.error.className = "definition-file-error";
    this.error.setAttribute("role", "status");
    this.body = doc.createElement("pre");
    this.body.tabIndex = 0;
    this.body.setAttribute("aria-label", "定義ファイルの内容（読み取り専用）");
    this.body.style.whiteSpace = "pre-wrap";
    this.body.style.overflowWrap = "anywhere";
    this.body.style.userSelect = "text";
    this.body.style.overflowY = "auto";
    this.body.style.maxHeight = "60vh";
    const close = doc.createElement("button");
    close.type = "button";
    close.dataset["closeDefinition"] = "";
    close.textContent = "閉じる";
    close.addEventListener("click", () => this.close());
    this.dialog.addEventListener("close", () => { if (!this.dialog.open) this.generation++; });
    this.dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); this.close(); }
    });
    this.dialog.append(this.heading, this.origin, this.error, this.body, close);
    doc.body.append(this.dialog);
  }

  get isOpen(): boolean { return !this.disposed && this.dialog.open; }

  async open(source: DefinitionSource, title: string): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.heading.textContent = title;
    this.origin.textContent = `${source.path} — ${source.kind === "disk" ? "ディスク上の内容" : "仮想ソース"}（読み取り専用）`;
    this.body.textContent = "";
    this.error.textContent = "";
    if (!this.dialog.open) this.dialog.show();
    if (source.kind === "virtual") { this.body.textContent = source.content; return; }
    this.error.textContent = "読み込み中…";
    try {
      const file = await this.options.readFile(source.path);
      if (!this.isOpen || generation !== this.generation) return;
      this.body.textContent = file.content;
      this.error.textContent = "";
    } catch (error) {
      if (this.isOpen && generation === this.generation) this.error.textContent = `表示できませんでした: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private close(): void {
    this.generation++;
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.close();
    this.disposed = true;
    this.dialog.remove();
  }
}

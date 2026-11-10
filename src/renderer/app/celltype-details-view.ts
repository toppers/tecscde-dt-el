import type { AppStore } from "./store";
import type { CelltypeRef } from "../model/celltype";
import { definitionFooter, definitionLocation, type DefinitionLocation, type DefinitionSource } from "./definition-source";

export interface CelltypeDetailsViewOptions {
  readonly store: Pick<AppStore, "getDocument" | "getGeneratedTypeSources">;
  readonly onShowDefinition: (source: DefinitionSource) => void;
  readonly document?: Document;
}

/** Details are a separate explicit action from choosing a placement celltype. */
export class CelltypeDetailsView {
  private readonly doc: Document;
  private readonly dialog: HTMLDialogElement;
  private name: string | undefined;
  private renderedName: string | undefined;
  private renderedType: CelltypeRef | undefined;
  private renderedLocation: DefinitionLocation | undefined;
  private disposed = false;

  constructor(private readonly options: CelltypeDetailsViewOptions) {
    this.doc = options.document ?? document;
    this.dialog = this.doc.createElement("dialog");
    this.dialog.className = "celltype-details-dialog";
    this.dialog.id = "celltype-details-dialog";
    this.dialog.setAttribute("aria-label", "セルタイプ詳細");
    this.dialog.addEventListener("keydown", (event) => event.stopPropagation());
    this.doc.body.append(this.dialog);
  }

  get isOpen(): boolean { return !this.disposed && this.dialog.open; }

  open(name: string): void {
    if (this.disposed) return;
    this.name = name;
    this.renderedName = undefined;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  render(): void {
    if (this.disposed || !this.name) return;
    const type = this.options.store.getDocument().getCelltype(this.name);
    const source = type ? definitionLocation(type.generated ? type.locale : type.sourcePath ?? type.locale,
      this.options.store.getGeneratedTypeSources(), type.generated) : undefined;
    const priorSource = this.renderedLocation?.source;
    const nextSource = source?.source;
    if (this.renderedName === this.name && this.renderedType === type && this.renderedLocation?.label === source?.label &&
        priorSource?.kind === nextSource?.kind && priorSource?.path === nextSource?.path &&
        (priorSource?.kind === "virtual" ? priorSource.content : undefined) ===
        (nextSource?.kind === "virtual" ? nextSource.content : undefined)) return;
    this.renderedName = this.name;
    this.renderedType = type;
    this.renderedLocation = source;
    this.dialog.replaceChildren();
    const heading = this.doc.createElement("h2");
    heading.textContent = "セルタイプ詳細";
    this.dialog.append(heading);
    const append = (label: string, text: string): void => {
      const field = this.doc.createElement("p");
      field.textContent = `${label}: ${text}`;
      this.dialog.append(field);
    };
    if (!type) append("セルタイプ", `${this.name} が見つかりません。`);
    else {
      append("名前", type.name);
      append("種別", type.composite ? "複合セルタイプ" : "通常セルタイプ");
      append("呼び口", type.cportTemplates.map((port) => `${port.name}: ${port.signature}`).join(", ") || "なし");
      append("受け口", type.eportTemplates.map((port) => `${port.name}: ${port.signature}`).join(", ") || "なし");
      append("属性", type.attributeNames.join(", ") || "なし");
      if (type.hiddenRequirePortCount > 0) append("非表示のrequire", String(type.hiddenRequirePortCount));
      if (type.hasUnsupportedSyntax) append("状態", "未対応構文があります。");
      append("定義元", type.locale?.split(/[\\/]/).at(-1) || "なし");
      this.dialog.append(definitionFooter(this.doc, source!, (definition) => {
        // A modeless definition window cannot receive input behind a modal.
        if (this.dialog.open) this.dialog.close();
        this.options.onShowDefinition(definition);
      }));
    }
    const close = this.doc.createElement("button");
    close.type = "button";
    close.textContent = "閉じる";
    close.addEventListener("click", () => this.dialog.close());
    this.dialog.append(close);
  }

  dispose(): void {
    this.disposed = true;
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }
}

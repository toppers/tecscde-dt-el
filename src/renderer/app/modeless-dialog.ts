/** 02B: a modeless wrapper around an existing panel; all state stays in that panel. */
export interface ModelessDialogOptions {
  readonly document?: Document;
  readonly title: string;
  readonly id: string;
  readonly content: HTMLElement;
  readonly initialPosition?: { readonly x: number; readonly y: number };
}

let nextZIndex = 100;
let nextOffset = 0;

export class ModelessDialog {
  private readonly doc: Document;
  private readonly dialog: HTMLDialogElement;
  private readonly header: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly originalParent: Node | null;
  private readonly originalNextSibling: Node | null;
  private disposed = false;
  private drag: { pointerId: number; x: number; y: number; left: number; top: number } | undefined;

  constructor(private readonly options: ModelessDialogOptions) {
    this.doc = options.document ?? options.content.ownerDocument;
    this.originalParent = options.content.parentNode;
    this.originalNextSibling = options.content.nextSibling;
    this.dialog = this.doc.createElement("dialog");
    this.dialog.id = options.id;
    this.dialog.className = "modeless-dialog";
    this.dialog.dataset["modeless"] = options.id;
    this.dialog.setAttribute("aria-modal", "false");
    this.dialog.setAttribute("aria-labelledby", options.id + "-heading");
    this.dialog.style.position = "fixed";
    this.dialog.style.margin = "0";
    this.header = this.doc.createElement("header");
    this.header.className = "modeless-dialog-header";
    this.header.dataset["modelessHeader"] = "";
    this.header.style.touchAction = "none";
    this.header.style.cursor = "move";
    const title = this.doc.createElement("h2");
    title.id = options.id + "-heading";
    title.textContent = options.title;
    this.closeButton = this.doc.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.textContent = "閉じる";
    this.closeButton.dataset["modelessClose"] = "";
    this.closeButton.setAttribute("aria-label", options.title + "を閉じる");
    this.header.append(title, this.closeButton);
    const body = this.doc.createElement("div");
    body.className = "modeless-dialog-body";
    body.append(options.content);
    this.dialog.append(this.header, body);
    const offset = (nextOffset++ % 6) * 24;
    const position = options.initialPosition ?? { x: 48 + offset, y: 72 + offset };
    this.position(position.x, position.y);
    this.closeButton.addEventListener("click", this.onCloseClick);
    this.dialog.addEventListener("keydown", this.onKey);
    this.dialog.addEventListener("pointerdown", this.bringToFront);
    this.dialog.addEventListener("close", this.onNativeClose);
    this.header.addEventListener("pointerdown", this.onDragStart);
    this.doc.defaultView?.addEventListener("resize", this.onResize);
    this.doc.body.append(this.dialog);
  }

  get isOpen(): boolean { return !this.disposed && this.dialog.open; }

  open(): void {
    if (this.disposed) return;
    this.onResize();
    this.bringToFront();
    // Reopening an existing window only raises it: retain form focus and draft.
    if (!this.dialog.open) this.dialog.show();
  }

  close(): void {
    this.stopDrag();
    if (!this.disposed && this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
    this.closeButton.removeEventListener("click", this.onCloseClick);
    this.dialog.removeEventListener("keydown", this.onKey);
    this.dialog.removeEventListener("pointerdown", this.bringToFront);
    this.dialog.removeEventListener("close", this.onNativeClose);
    this.header.removeEventListener("pointerdown", this.onDragStart);
    this.doc.defaultView?.removeEventListener("resize", this.onResize);
    if (this.originalParent) {
      const next = this.originalNextSibling?.parentNode === this.originalParent ? this.originalNextSibling : null;
      this.originalParent.insertBefore(this.options.content, next);
    } else this.options.content.remove();
    this.dialog.remove();
  }

  private readonly bringToFront = (): void => {
    this.dialog.style.zIndex = String(++nextZIndex);
  };
  private readonly onCloseClick = (): void => { this.close(); };
  private readonly onNativeClose = (): void => {
    // A queued close event from the preceding open must not end a new drag.
    if (!this.dialog.open) this.stopDrag();
  };
  private readonly onResize = (): void => {
    this.position(parseFloat(this.dialog.style.left), parseFloat(this.dialog.style.top));
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!event.isComposing) { event.preventDefault(); this.close(); }
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest("input, textarea, select, button, [contenteditable], [role='textbox']")) {
      // Keep native editing/activation defaults; only stop canvas shortcuts.
      event.stopPropagation();
    }
  };

  private position(x: number, y: number): void {
    const viewport = this.doc.defaultView;
    this.dialog.style.left = Math.max(0, Math.min(x, viewport ? viewport.innerWidth - 48 : x)) + "px";
    this.dialog.style.top = Math.max(0, Math.min(y, viewport ? viewport.innerHeight - 32 : y)) + "px";
  }

  private readonly onDragStart = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag || (event.target as Element | null)?.closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    this.bringToFront();
    this.closeButton.focus({ preventScroll: true });
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: parseFloat(this.dialog.style.left), top: parseFloat(this.dialog.style.top) };
    this.doc.addEventListener("pointermove", this.onDragMove);
    this.doc.addEventListener("pointerup", this.onDragEnd);
    this.doc.addEventListener("pointercancel", this.onDragEnd);
    try { this.header.setPointerCapture(event.pointerId); } catch { /* Synthetic/detached pointer. */ }
  };
  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    event.preventDefault();
  };
  private readonly onDragEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId) this.stopDrag();
  };
  private stopDrag(): void {
    const pointerId = this.drag?.pointerId;
    this.drag = undefined;
    this.doc.removeEventListener("pointermove", this.onDragMove);
    this.doc.removeEventListener("pointerup", this.onDragEnd);
    this.doc.removeEventListener("pointercancel", this.onDragEnd);
    if (pointerId !== undefined) {
      try { this.header.releasePointerCapture(pointerId); } catch { /* Already released. */ }
    }
  }
}

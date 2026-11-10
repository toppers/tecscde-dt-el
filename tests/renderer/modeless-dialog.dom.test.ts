/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelessDialog } from "../../src/renderer/app/modeless-dialog";

function fixture(id = "files", position = { x: 40, y: 70 }) {
  const parent = document.createElement("section");
  const content = document.createElement("div");
  const existingButton = document.createElement("button");
  existingButton.textContent = "existing";
  const input = document.createElement("input");
  input.value = "draft";
  content.append(existingButton, input);
  const marker = document.createElement("span");
  parent.append(content, marker);
  document.body.append(parent);
  const dialog = new ModelessDialog({ document, id, title: id, content, initialPosition: position });
  const element = document.getElementById(id) as HTMLDialogElement;
  return { parent, content, existingButton, input, marker, dialog, element };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => { throw new Error("must be modeless"); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("ModelessDialog", () => {
  it("activates the modeless window when its header is pressed so Escape cannot reach the canvas", () => {
    const { dialog, element } = fixture();
    const outside = document.createElement("input"); document.body.append(outside);
    dialog.open(); outside.focus();
    const header = element.querySelector<HTMLElement>(".modeless-dialog-header")!;
    header.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 50, clientY: 75, bubbles: true }));
    expect(element.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(dialog.isOpen).toBe(false); dialog.dispose();
  });
  it("moves the existing content once, opens with show(), and preserves its listeners and draft on close/reopen", () => {
    const { dialog, element, content, existingButton, input } = fixture();
    const existingListener = vi.fn();
    existingButton.addEventListener("click", existingListener);
    dialog.open();
    expect(HTMLDialogElement.prototype.show).toHaveBeenCalledOnce();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(element.contains(content)).toBe(true);
    expect(element.classList.contains("modeless-dialog")).toBe(true);
    expect(element.querySelector(".modeless-dialog-body")?.contains(content)).toBe(true);
    expect(element.getAttribute("aria-modal")).toBe("false");
    input.value = "edited draft";
    existingButton.click();
    element.querySelector<HTMLButtonElement>("[data-modeless-close]")!.click();
    expect(dialog.isOpen).toBe(false);
    dialog.open();
    expect(element.contains(content)).toBe(true);
    expect(input.value).toBe("edited draft");
    existingButton.click();
    expect(existingListener).toHaveBeenCalledTimes(2);
    dialog.dispose();
  });

  it("keeps two independent dialogs open and only raises an existing dialog without resetting position or focus", () => {
    const first = fixture("first", { x: 20, y: 50 });
    const second = fixture("second", { x: 260, y: 90 });
    first.dialog.open(); second.dialog.open();
    expect(first.dialog.isOpen).toBe(true); expect(second.dialog.isOpen).toBe(true);
    expect(second.element.style.left).toBe("260px");
    expect(Number(second.element.style.zIndex)).toBeGreaterThan(Number(first.element.style.zIndex));
    first.input.focus();
    first.dialog.open();
    expect(HTMLDialogElement.prototype.show).toHaveBeenCalledTimes(2);
    expect(Number(first.element.style.zIndex)).toBeGreaterThan(Number(second.element.style.zIndex));
    expect(first.element.style.left).toBe("20px");
    expect(document.activeElement).toBe(first.input);
    first.dialog.dispose(); second.dialog.dispose();
  });

  it("Escape inside closes only that dialog and stops graph Escape, while form Undo stays native", () => {
    const first = fixture("first"); const second = fixture("second");
    const graph = vi.fn();
    document.addEventListener("keydown", graph);
    try {
      first.dialog.open(); second.dialog.open();
      const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
      first.input.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(false);
      expect(graph).not.toHaveBeenCalled();
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      first.input.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(first.dialog.isOpen).toBe(false); expect(second.dialog.isOpen).toBe(true);
      expect(graph).not.toHaveBeenCalled();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      expect(graph).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", graph);
      first.dialog.dispose(); second.dialog.dispose();
    }
  });

  it("keeps IME Escape within the composing field without closing", () => {
    const { dialog, input } = fixture();
    dialog.open();
    const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    expect(dialog.isOpen).toBe(true); expect(escape.defaultPrevented).toBe(false);
    dialog.dispose();
  });

  it("moves only from a primary header drag and retains that view position after reopening", () => {
    const { dialog, element } = fixture();
    dialog.open();
    const header = element.querySelector<HTMLElement>("[data-modeless-header]")!;
    header.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 7, clientX: 50, clientY: 80, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 110, clientY: 120, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, bubbles: true }));
    expect(element.style.left).toBe("100px"); expect(element.style.top).toBe("110px");
    dialog.close(); dialog.open();
    expect(element.style.left).toBe("100px"); expect(element.style.top).toBe("110px");
    element.querySelector<HTMLElement>("[data-modeless-close]")!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 8, clientX: 110, clientY: 120, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 8, clientX: 400, clientY: 400, bubbles: true }));
    expect(element.style.left).toBe("100px");
    dialog.dispose();
  });

  it("restores the original DOM location on dispose and removes only its own drag/key listeners", () => {
    const { dialog, element, parent, content, marker, existingButton } = fixture();
    const existing = vi.fn(); existingButton.addEventListener("click", existing);
    dialog.open();
    element.querySelector<HTMLElement>("[data-modeless-header]")!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 7, clientX: 10, clientY: 10, bubbles: true }));
    dialog.dispose();
    expect(document.getElementById(element.id)).toBeNull();
    expect(parent.children[0]).toBe(content); expect(content.nextSibling).toBe(marker);
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 100, clientY: 100, bubbles: true }));
    expect(element.style.left).toBe("40px");
    existingButton.click(); expect(existing).toHaveBeenCalledOnce();
    dialog.open(); expect(dialog.isOpen).toBe(false);
    dialog.dispose();
  });

  it("keeps an edge-positioned header reachable after shrinking the viewport, including while closed", () => {
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const viewport = (x: number, y: number) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: x });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: y });
    };
    let instance: ModelessDialog | undefined;
    try {
      viewport(1280, 900);
      const { dialog, element } = fixture("edge", { x: 1200, y: 800 });
      instance = dialog;
      dialog.open();
      expect(element.style.left).toBe("1200px"); expect(element.style.top).toBe("800px");
      element.querySelector<HTMLElement>("[data-modeless-header]")!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 7, clientX: 0, clientY: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 100, clientY: 50, bubbles: true }));
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, bubbles: true }));
      dialog.close();
      viewport(640, 400); window.dispatchEvent(new Event("resize"));
      expect(element.style.left).toBe("592px"); expect(element.style.top).toBe("368px");
      dialog.open();
      expect(element.style.left).toBe("592px"); expect(element.style.top).toBe("368px");
      dialog.close();
      element.style.left = "2000px"; element.style.top = "2000px";
      dialog.open();
      expect(element.style.left).toBe("592px"); expect(element.style.top).toBe("368px");
      dialog.dispose();
      viewport(100, 100); window.dispatchEvent(new Event("resize"));
      expect(element.style.left).toBe("592px"); expect(element.style.top).toBe("368px");
    } finally {
      instance?.dispose();
      if (width) Object.defineProperty(window, "innerWidth", width); else Reflect.deleteProperty(window, "innerWidth");
      if (height) Object.defineProperty(window, "innerHeight", height); else Reflect.deleteProperty(window, "innerHeight");
    }
  });
});

import type { TecscdeDocument } from "../model/document";
import type { CompositeStructure } from "../model/composite";
import type { CellId } from "../model/ids";

const SVG_NS = "http://www.w3.org/2000/svg";
const BOX_WIDTH = 170;
const BOX_HEIGHT = 86;
const COLUMNS = 3;
const COLUMN_GAP = 60;
const ROW_GAP = 70;
const NODE_LEFT = 110;
const NODE_TOP = 80;

interface DiagramNode {
  readonly name: string;
  readonly celltypeName: string;
  readonly x: number;
  readonly y: number;
  readonly canOpen: boolean;
  readonly bindings: readonly string[];
}

interface DiagramLink {
  readonly kind: "internal" | "external" | "export";
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface CompositeDiagramLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly DiagramNode[];
  readonly links: readonly DiagramLink[];
}

function resolveCelltype(doc: TecscdeDocument, typeName: string, parentTypeName: string) {
  const normalized = typeName.replace(/^::/, "");
  if (typeName.startsWith("::") || normalized.includes("::")) return doc.getCelltype(normalized);
  const scopeEnd = parentTypeName.lastIndexOf("::");
  const scoped = scopeEnd < 0 ? normalized : `${parentTypeName.slice(0, scopeEnd)}::${normalized}`;
  return doc.getCelltype(scoped) ?? doc.getCelltype(normalized);
}

/** Computes only visible links. Attribute expressions remain on the cell label. */
export function layoutComposite(
  structure: CompositeStructure,
  isNestedComposite: (typeName: string) => boolean = () => false,
  isPortBinding: (typeName: string, name: string) => boolean = () => true,
): CompositeDiagramLayout {
  const names = new Set(structure.internalCells.map((cell) => cell.name));
  const nodes = structure.internalCells.map((cell, index) => ({
    name: cell.name,
    celltypeName: cell.celltypeName,
    x: NODE_LEFT + (index % COLUMNS) * (BOX_WIDTH + COLUMN_GAP),
    y: NODE_TOP + Math.floor(index / COLUMNS) * (BOX_HEIGHT + ROW_GAP),
    canOpen: isNestedComposite(cell.celltypeName),
    bindings: cell.bindings.map((binding) => `${binding.name} ${binding.kind === "external" ? "⇒" : "="} ${binding.kind === "external" ? `composite.${binding.target}` : binding.target}`),
  }));
  const links: DiagramLink[] = [];
  for (const cell of structure.internalCells) {
    for (const binding of cell.bindings) {
      if (binding.kind === "external") {
        links.push({ kind: "external", from: "composite", to: cell.name, label: binding.target });
        continue;
      }
      if (!isPortBinding(cell.celltypeName, binding.name)) continue;
      const targetCell = binding.target.split(".", 1)[0] ?? "";
      if (names.has(targetCell)) {
        links.push({ kind: "internal", from: cell.name, to: targetCell, label: binding.name });
      }
    }
  }
  for (const exported of structure.portExports) {
    if (names.has(exported.cellName)) {
      links.push({ kind: "export", from: exported.cellName, to: "composite", label: exported.externalPortName });
    }
  }
  return {
    width: NODE_LEFT * 2 + COLUMNS * BOX_WIDTH + (COLUMNS - 1) * COLUMN_GAP,
    height: Math.max(300, NODE_TOP * 2 + Math.ceil(nodes.length / COLUMNS) * BOX_HEIGHT + Math.max(0, Math.ceil(nodes.length / COLUMNS) - 1) * ROW_GAP),
    nodes,
    links,
  };
}

function svgElement<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag);
}

function addText(doc: Document, parent: SVGElement, x: number, y: number, value: string, className: string): void {
  const text = svgElement(doc, "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("class", className);
  text.textContent = value;
  parent.append(text);
}

function shortLabel(value: string): string {
  return value.length > 24 ? `${value.slice(0, 21)}…` : value;
}

interface DiagramLevel {
  readonly typeName: string;
  readonly label: string;
}

/** Separate read-only diagram, leaving the main document and its History untouched. */
export class CompositeDiagramView {
  private readonly overlay: HTMLDivElement;
  private readonly breadcrumbs: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly svg: SVGSVGElement;
  private readonly doc: Document;
  private documentModel: TecscdeDocument | null = null;
  private levels: DiagramLevel[] = [];
  private opener: Element | null = null;

  constructor(doc: Document) {
    this.doc = doc;
    this.overlay = doc.createElement("div");
    this.overlay.className = "composite-overlay";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", "複合セルタイプの内部図");
    this.overlay.hidden = true;

    const panel = doc.createElement("div");
    panel.className = "composite-panel";
    const header = doc.createElement("div");
    header.className = "composite-header";
    this.backButton = doc.createElement("button");
    this.backButton.type = "button";
    this.backButton.addEventListener("click", () => this.back());
    this.breadcrumbs = doc.createElement("nav");
    this.breadcrumbs.setAttribute("aria-label", "複合セルの階層");
    this.closeButton = doc.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.textContent = "閉じる";
    this.closeButton.addEventListener("click", () => this.close());
    header.append(this.backButton, this.breadcrumbs, this.closeButton);
    const hint = doc.createElement("p");
    hint.className = "composite-hint";
    hint.textContent = "内部図は閲覧専用です。複合セルをダブルクリックすると次の階層を表示します。";
    this.svg = svgElement(doc, "svg");
    this.svg.classList.add("composite-canvas");
    this.svg.setAttribute("role", "group");
    this.svg.setAttribute("aria-label", "複合セルタイプの内部セルと接続");
    this.svg.addEventListener("dblclick", (event) => this.openFromEvent(event));
    this.svg.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.openFromEvent(event);
    });
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        this.back();
      } else if (event.key === "Tab") {
        const focusables: Array<HTMLButtonElement | SVGGElement> = [
          this.backButton,
          this.closeButton,
          ...Array.from(this.svg.querySelectorAll<SVGGElement>('[tabindex="0"]')),
        ];
        const active = this.doc.activeElement;
        if (event.shiftKey && active === focusables[0]) {
          event.preventDefault();
          focusables.at(-1)?.focus();
        } else if (!event.shiftKey && active === focusables.at(-1)) {
          event.preventDefault();
          focusables[0]?.focus();
        }
      }
    });
    panel.append(header, hint, this.svg);
    this.overlay.append(panel);
    doc.body.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  openCell(doc: TecscdeDocument, cellId: CellId): boolean {
    const cell = doc.getCell(cellId);
    const type = cell && resolveCelltype(doc, cell.celltypeName, cell.celltypeName);
    if (!cell || !type?.composite) return false;
    this.documentModel = doc;
    this.levels = [{ typeName: type.name, label: cell.name }];
    this.opener = this.doc.activeElement;
    this.overlay.hidden = false;
    this.render();
    this.backButton.focus();
    return true;
  }

  sync(doc: TecscdeDocument): void {
    if (this.isOpen && this.documentModel !== doc) this.close();
  }

  back(): void {
    if (this.levels.length <= 1) {
      this.close();
      return;
    }
    this.levels.pop();
    this.render();
    this.backButton.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.overlay.hidden = true;
    this.documentModel = null;
    this.levels = [];
    if (this.opener && "focus" in this.opener) (this.opener as HTMLElement).focus();
    this.opener = null;
  }

  dispose(): void {
    this.close();
    this.overlay.remove();
  }

  private openFromEvent(event: Event): void {
    const target = event.target as Element | null;
    const group = target?.closest<SVGGElement>("[data-internal-cell]");
    const name = group?.dataset["internalCell"];
    const doc = this.documentModel;
    const current = this.levels.at(-1);
    const structure = current && doc?.getCelltype(current.typeName)?.composite;
    const internal = structure?.internalCells.find((cell) => cell.name === name);
    const nested = internal && current && doc && resolveCelltype(doc, internal.celltypeName, current.typeName);
    if (!internal || !nested?.composite || this.levels.length >= 32) return;
    event.preventDefault();
    this.levels.push({ typeName: nested.name, label: internal.name });
    this.render();
    this.backButton.focus();
  }

  private render(): void {
    const doc = this.documentModel;
    const current = this.levels.at(-1);
    const structure = current && doc?.getCelltype(current.typeName)?.composite;
    if (!doc || !current || !structure) return;
    this.backButton.textContent = this.levels.length > 1 ? "戻る" : "元の図へ戻る";
    this.breadcrumbs.textContent = ["元の図", ...this.levels.map((level) => level.label)].join(" › ");
    const layout = layoutComposite(
      structure,
      (typeName) => Boolean(resolveCelltype(doc, typeName, current.typeName)?.composite),
      (typeName, name) => {
        const celltype = resolveCelltype(doc, typeName, current.typeName);
        return !celltype || celltype.cportTemplates.some((port) => port.name === name);
      },
    );
    this.svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    this.svg.replaceChildren();
    const byName = new Map(layout.nodes.map((node) => [node.name, node]));
    for (const link of layout.links) {
      const from = byName.get(link.from);
      const to = byName.get(link.to);
      const x1 = from ? from.x + BOX_WIDTH : 35;
      const y1 = from ? from.y + BOX_HEIGHT / 2 : to ? to.y + BOX_HEIGHT / 2 : NODE_TOP;
      const x2 = to ? to.x : layout.width - 35;
      const y2 = to ? to.y + BOX_HEIGHT / 2 : from ? from.y + BOX_HEIGHT / 2 : NODE_TOP;
      const line = svgElement(this.doc, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("class", `composite-link composite-link-${link.kind}`);
      line.dataset["linkKind"] = link.kind;
      const title = svgElement(this.doc, "title");
      title.textContent = `${link.from} → ${link.to}: ${link.label}`;
      line.append(title);
      this.svg.append(line);
      if (link.kind !== "internal") {
        const labelX = link.kind === "external" ? 8 : layout.width - 105;
        addText(this.doc, this.svg, labelX, y1 - 7, `composite.${link.label}`, "composite-port-label");
      }
    }
    for (const node of layout.nodes) {
      const group = svgElement(this.doc, "g");
      group.dataset["internalCell"] = node.name;
      group.setAttribute("class", node.canOpen ? "composite-node can-open" : "composite-node");
      if (node.canOpen) {
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", `${node.name} の内部図を開く`);
      }
      const rect = svgElement(this.doc, "rect");
      rect.setAttribute("x", String(node.x));
      rect.setAttribute("y", String(node.y));
      rect.setAttribute("width", String(BOX_WIDTH));
      rect.setAttribute("height", String(BOX_HEIGHT));
      rect.setAttribute("rx", "6");
      group.append(rect);
      addText(this.doc, group, node.x + 12, node.y + 25, shortLabel(node.name), "composite-node-name");
      addText(this.doc, group, node.x + 12, node.y + 45, shortLabel(node.celltypeName), "composite-node-type");
      addText(this.doc, group, node.x + 12, node.y + 67, shortLabel(node.bindings[0] ?? (node.canOpen ? "内部を表示 ↗" : "")), "composite-node-binding");
      const title = svgElement(this.doc, "title");
      title.textContent = `${node.name}: ${node.celltypeName}${node.bindings.length ? `\n${node.bindings.join("\n")}` : ""}`;
      group.append(title);
      this.svg.append(group);
    }
    if (layout.nodes.length === 0) addText(this.doc, this.svg, 40, 80, "内部セルはありません", "composite-empty");
  }
}

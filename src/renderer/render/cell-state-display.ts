import type { Cell } from "../model/cell";
import type { TecscdeDocument } from "../model/document";
import type { Diagnostic } from "../diagnostics/types";
import { portTypeKey, type PortTypeIndex } from "../cdl/port-type-index";
import { pxPerMm, type CanvasView } from "./view";

export interface UnconnectedCallPort { readonly id: string; readonly name: string; readonly subscript: number | null }
export interface CellVisualState {
  readonly readOnly: boolean;
  readonly incompleteReasons: readonly string[];
  readonly unconnectedCallPorts: readonly UnconnectedCallPort[] | null;
}

const structuralCodes = new Set(["W-MISSING-JOIN-TARGET", "W-PORT-SIGNATURE-UNRESOLVED", "W-C-TYPE-UNRESOLVED"]);
const portName = (port: { readonly name: string; readonly subscript: number | null }): string =>
  `${port.name}${port.subscript === null ? "" : `[${port.subscript}]`}`;

/** Uses current structural results only; environmental and operation warnings are unrelated. */
export function deriveCellVisualState(doc: TecscdeDocument | undefined, cell: Cell, structuralIssues: readonly Diagnostic[] = [], portTypes?: PortTypeIndex): CellVisualState {
  const reasons = new Set<string>();
  if (cell.celltypeUnresolved) reasons.add("セルタイプを解決できません。");
  for (const issue of structuralIssues) {
    if (!structuralCodes.has(issue.code) || issue.relatedCellId !== cell.id) continue;
    if (issue.relatedPortName) {
      const ports = [...cell.cports, ...cell.eports].filter((port) => port.name === issue.relatedPortName);
      if (!ports.length) continue;
      if (issue.code === "W-MISSING-JOIN-TARGET") {
        const unresolved = cell.cports.filter((port) => port.name === issue.relatedPortName).some((port) => {
          const join = port.joinId && doc?.getJoin(port.joinId);
          return !join || !doc?.getCell(join.eportCellId);
        });
        if (!unresolved) continue;
      }
    }
    reasons.add(issue.message);
  }
  for (const [direction, ports] of [["call", cell.cports], ["entry", cell.eports]] as const) {
    for (const port of ports) {
      const resolved = portTypes?.ports.get(portTypeKey(cell.celltypeName, direction, port.name));
      if (resolved && !resolved.valid) reasons.add(`ポート ${portName(port)} のシグニチャ・型を解決できません。`);
    }
  }
  return {
    readOnly: !cell.editable,
    incompleteReasons: [...reasons],
    unconnectedCallPorts: cell.celltypeUnresolved ? null : cell.cports.filter((port) => port.joinId === null)
      .map((port) => ({ id: `${cell.id}.${portName(port)}`, name: port.name, subscript: port.subscript })),
  };
}

export function cellVisualStateDescription(cell: Cell, state: CellVisualState): string {
  const connectivity = state.unconnectedCallPorts === null ? "型が未解決のため未結合を判定できません。"
    : state.unconnectedCallPorts.length ? `未結合の呼び口 ${state.unconnectedCallPorts.length}件: ${state.unconnectedCallPorts.map(portName).join("、")}。optionalの呼び口は未結合でもエラーとは限りません。`
      : "未結合の呼び口はありません。";
  return `${cell.name}。${state.readOnly ? "編集不可" : "編集可能"}。${state.incompleteReasons.length ? `不完全: ${state.incompleteReasons.join(" ")}` : "不完全の理由はありません。"}${connectivity}`;
}

export type CellStateBadge = "readonly" | "incomplete" | "unconnected";
const badgeText = { readonly: "RO", incomplete: "!", unconnected: "U" } as const;
const badgeWidth = { readonly: 6, incomplete: 3.5, unconnected: 3 } as const;

/** Shared SVG primitives for both cell state rows and the fixed legend. */
export function appendStateBadge(parent: SVGElement, kind: CellStateBadge, x: number, y: number, width: number, height: number): void {
  const doc = parent.ownerDocument, ns = "http://www.w3.org/2000/svg";
  const group = doc.createElementNS(ns, "g"); group.dataset["state"] = kind;
  const shape = doc.createElementNS(ns, kind === "readonly" ? "rect" : kind === "incomplete" ? "polygon" : "circle");
  if (kind === "readonly") {
    shape.setAttribute("x", String(x)); shape.setAttribute("y", String(y)); shape.setAttribute("width", String(width)); shape.setAttribute("height", String(height));
  } else if (kind === "incomplete") shape.setAttribute("points", `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`);
  else { shape.setAttribute("cx", String(x + width / 2)); shape.setAttribute("cy", String(y + height / 2)); shape.setAttribute("r", String(Math.min(width, height) / 2)); }
  shape.setAttribute("fill", "#ffffff"); shape.setAttribute("stroke", "#111111"); shape.setAttribute("stroke-width", String(Math.max(0.15, height * 0.06)));
  const text = doc.createElementNS(ns, "text"); text.textContent = badgeText[kind];
  text.setAttribute("x", String(x + width / 2)); text.setAttribute("y", String(y + height * 0.76));
  text.setAttribute("text-anchor", "middle"); text.setAttribute("font-size", String(height * (kind === "readonly" ? 0.65 : 0.75)));
  text.setAttribute("font-family", "sans-serif"); text.setAttribute("fill", "#111111");
  group.append(shape, text); parent.append(group);
}

/** Badges live inside cell geometry; they never become hit-test targets or model data. */
export function appendCellStateIndicators(element: SVGGElement, cell: Cell, state: CellVisualState, view: CanvasView): void {
  element.querySelector(".cell-status-badges")?.remove();
  element.querySelector(".cell-status-description")?.remove();
  element.setAttribute("aria-label", cellVisualStateDescription(cell, state));
  const title = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "title");
  title.setAttribute("class", "cell-status-description"); title.textContent = cellVisualStateDescription(cell, state); element.append(title);
  const badges: CellStateBadge[] = [];
  if (state.readOnly) badges.push("readonly");
  if (state.incompleteReasons.length) badges.push("incomplete");
  if (state.unconnectedCallPorts?.length) badges.push("unconnected");
  const scale = pxPerMm(view);
  const name = element.querySelector<SVGTextElement>(".cell-label");
  const type = element.querySelector<SVGTextElement>(".celltype-label");
  if (!badges.length) {
    if (name) { name.setAttribute("y", String((cell.y + cell.height / 2) * scale - (view.emphasizeCellName ? 0 : 3))); name.removeAttribute("font-size"); }
    if (type) { type.setAttribute("y", String((cell.y + cell.height / 2) * scale + 9)); type.removeAttribute("font-size"); }
    return;
  }
  const left = Math.min(2.5, cell.width * 0.3), right = Math.min(1, cell.width * 0.06);
  const totalWidth = badges.reduce((total, badge) => total + badgeWidth[badge], 0) + (badges.length - 1) * 0.8;
  const factor = Math.min(1, (cell.width - left - right) / totalWidth, cell.height * 0.24 / 3);
  const height = 3 * factor, bottom = Math.min(1.5, cell.height * 0.18), top = Math.min(1, cell.height * 0.08);
  const labelSpace = Math.max(0.1, cell.height - bottom - height - top - 0.5);
  const font = Math.min(2.4, labelSpace / 2.4);
  if (name) {
    name.setAttribute("y", String((cell.y + top + (view.emphasizeCellName ? labelSpace / 2 : font)) * scale));
    name.setAttribute("font-size", String((view.emphasizeCellName ? Math.min(3.5, labelSpace * 0.7) : font) * scale));
  }
  if (type) { type.setAttribute("y", String((cell.y + top + font * 2.15) * scale)); type.setAttribute("font-size", String(font * scale)); }
  const row = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
  row.setAttribute("class", "cell-status-badges"); row.setAttribute("pointer-events", "none"); row.setAttribute("aria-hidden", "true");
  let x = cell.x + left;
  for (const badge of badges) {
    appendStateBadge(row, badge, x * scale, (cell.y + cell.height - bottom - height) * scale, badgeWidth[badge] * factor * scale, height * scale);
    x += (badgeWidth[badge] + 0.8) * factor;
  }
  element.append(row);
}

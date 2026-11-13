/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { deriveCellVisualState, appendCellStateIndicators, cellVisualStateDescription } from "../../src/renderer/render/cell-state-display";
import { CellStateLegendView } from "../../src/renderer/app/cell-state-legend";
import { renderRegionOutlines } from "../../src/renderer/render/region-outlines";
import { Cell } from "../../src/renderer/model/cell";
import { CPort, EPort } from "../../src/renderer/model/port";
import { asCellId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { defaultCanvasView, MM_TO_PX } from "../../src/renderer/render/view";
import { emptyPortTypeIndex, portTypeKey } from "../../src/renderer/cdl/port-type-index";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { AppStore } from "../../src/renderer/app/store";
import { SelectionState } from "../../src/renderer/render/view";

function cell(overrides: Partial<Parameters<typeof Cell.create>[0]> = {}) {
  return Cell.create({ id: asCellId("C"), name: "C", celltypeName: "tC", x: 10, y: 10, width: 30, height: 15,
    regionId: ROOT_REGION_ID, editable: true, celltypeUnresolved: false, attrs: {},
    cports: [CPort.create({ name: "c", signature: "s", edgeSide: "LEFT", offset: 5 })],
    eports: [EPort.create({ name: "e", signature: "s", edgeSide: "RIGHT", offset: 5 })], ...overrides });
}
describe("independent cell state", () => {
  it("derives read-only from editability and unconnected call elements only, including array subscripts", () => {
    const current = cell({ editable: false, systemDefined: false, cports: [
      CPort.create({ name: "c", signature: "s", edgeSide: "LEFT", offset: 5, subscript: 3 }),
      CPort.create({ name: "optional", signature: "s", edgeSide: "LEFT", offset: 8 }),
    ] });
    const state = deriveCellVisualState(undefined, current);
    expect(state.readOnly).toBe(true);
    expect(state.incompleteReasons).toEqual([]);
    expect(state.unconnectedCallPorts?.map((port) => port.id)).toEqual(["C.c[3]", "C.optional"]);
    expect(cellVisualStateDescription(current, state)).toContain("c[3]");
    expect(deriveCellVisualState(undefined, cell({ systemDefined: true })).readOnly).toBe(false);
  });

  it("distinguishes unknown connectivity from none and excludes environment/operation warnings", () => {
    const current = cell({ celltypeUnresolved: true });
    const state = deriveCellVisualState(undefined, current, [{ severity: "warning", code: "W-TECSGEN-VERSION-UNKNOWN", relatedCellId: current.id, message: "environment failure" }]);
    expect(state.unconnectedCallPorts).toBeNull();
    expect(state.incompleteReasons).toEqual(["セルタイプを解決できません。"]);
    expect(cellVisualStateDescription(current, state)).toContain("判定できません");
    expect(cellVisualStateDescription(current, state)).not.toContain("environment failure");
  });

  it("uses current port type results and current cell-linked structural issues without reviving obsolete ports", () => {
    const current = cell();
    const index = { ...emptyPortTypeIndex(), ports: new Map([[portTypeKey("tC", "call", "c"), { valid: false }]]) };
    const state = deriveCellVisualState(undefined, current, [
      { severity: "warning", code: "W-MISSING-JOIN-TARGET", relatedCellId: current.id, relatedPortName: "gone", message: "obsolete reason" },
      { severity: "warning", code: "W-MISSING-JOIN-TARGET", relatedCellId: asCellId("Other"), relatedPortName: "c", message: "other cell reason" },
    ], index);
    expect(state.incompleteReasons.join(" ")).toContain("c");
    expect(state.incompleteReasons.join(" ")).not.toContain("obsolete");
    expect(state.incompleteReasons.join(" ")).not.toContain("other cell");
  });
});

describe("state badges and text", () => {
  it("draws independent square RO, triangle ! and circle U in order with opaque colors and accessible reasons", () => {
    const current = cell({ editable: false });
    const state = { readOnly: true, incompleteReasons: ["構造が未解決です。"], unconnectedCallPorts: [{ name: "c", subscript: null, id: "C.c" }] };
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.innerHTML = '<text class="cell-label">C</text><text class="celltype-label">tC</text>';
    appendCellStateIndicators(group, current, state, defaultCanvasView());
    const badges = group.querySelector(".cell-status-badges")!;
    expect(badges.getAttribute("pointer-events")).toBe("none");
    expect(Array.from(badges.querySelectorAll("text")).map((text) => text.textContent)).toEqual(["RO", "!", "U"]);
    expect(badges.querySelector("[data-state=readonly] rect")).not.toBeNull();
    expect(badges.querySelector("[data-state=incomplete] polygon")).not.toBeNull();
    expect(badges.querySelector("[data-state=unconnected] circle")).not.toBeNull();
    expect(Array.from(badges.querySelectorAll("rect,polygon,circle")).every((shape) => shape.getAttribute("fill") === "#ffffff" && shape.getAttribute("stroke") === "#111111")).toBe(true);
    expect(group.getAttribute("aria-label")).toContain("編集不可");
    expect(group.getAttribute("aria-label")).toContain("構造が未解決");
    expect(group.getAttribute("aria-label")).toContain("1件");
  });

  it("scales symbols with zoom, removes resolved states, and fits all badges/labels inside a small cell", () => {
    const current = cell({ width: 10, height: 8 });
    const state = { readOnly: true, incompleteReasons: ["未解決"], unconnectedCallPorts: [{ name: "c", subscript: null, id: "C.c" }] };
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.innerHTML = '<text class="cell-label">C</text><text class="celltype-label">tC</text>';
    appendCellStateIndicators(group, current, state, { ...defaultCanvasView(), zoom: 2 });
    const box = group.querySelector("[data-state=readonly] rect")!;
    expect(Number(box.getAttribute("x"))).toBeGreaterThan(current.x * MM_TO_PX * 2);
    expect(Number(box.getAttribute("y")) + Number(box.getAttribute("height"))).toBeLessThan((current.y + current.height) * MM_TO_PX * 2);
    appendCellStateIndicators(group, current, { readOnly: false, incompleteReasons: [], unconnectedCallPorts: [] }, defaultCanvasView());
    expect(group.querySelector(".cell-status-badges")).toBeNull();
    expect(group.getAttribute("aria-label")).not.toContain("編集不可");
  });

  it("renders a fixed legend using the same shapes, and property reasons share the derived state", () => {
    const legend = document.createElement("div");
    new CellStateLegendView(legend).render();
    expect(legend.textContent).toContain("セルの状態");
    expect(legend.textContent).toContain("編集不可");
    expect(legend.querySelector("[data-state=readonly] rect")).not.toBeNull();
    expect(legend.querySelector("[data-state=incomplete] polygon")).not.toBeNull();
    expect(legend.querySelector("[data-state=unconnected] circle")).not.toBeNull();
    const doc = CdlDocumentLoader.loadSingle("cell Missing C {};", "main.cdl").document;
    const store = new AppStore(doc); store.setSelection(SelectionState.ofCells([asCellId("C")]));
    const root = document.createElement("div"); new PropertyPanelView(root, store).render();
    expect(root.querySelector(".cell-state-description")!.textContent).toContain("判定できません");
    expect(root.querySelector(".cell-state-description")!.textContent).toContain("セルタイプを解決できません");
    expect(store.isDirty()).toBe(false);
  });

  it("renders region lines/labels with shared colors and without pointer interception", () => {
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    renderRegionOutlines(layer, [{ regionId: "::A" as never, name: "::A", depth: 1, margin: 1, rectangles: [], segments: [{ x1: 1, y1: 2, x2: 3, y2: 2 }], labelPosition: { x: 1, y: 2 } }], defaultCanvasView(), new Map([["::A" as never, "#abc123"]]));
    expect(layer.getAttribute("pointer-events")).toBe("none");
    expect(layer.querySelector("path")!.getAttribute("stroke")).toBe("#abc123");
    expect(layer.querySelector("text")!.textContent).toBe("::A");
    expect(Number(layer.querySelector("text")!.getAttribute("x"))).toBeCloseTo(MM_TO_PX);
  });
});

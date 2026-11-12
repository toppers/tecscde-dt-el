/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SelectionState, defaultCanvasView, MM_TO_PX, type SelectedPort } from "../../src/renderer/render/view";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

const call: SelectedPort = { kind: "cport", cellId: asCellId("A"), portName: "p", subscript: 0 };

describe("port selection state", () => {
  it("keeps ports exclusive with cells/joins and limits multiple ports to one owner", () => {
    const second = { ...call, portName: "q" };
    const selected = SelectionState.ofPort(call).withPortAdded(second);
    expect(selected.isEmpty).toBe(false);
    expect(selected.ports).toHaveLength(2);
    expect(selected.withPortAdded(call)).toBe(selected);
    expect(selected.withPortToggled(call).ports).toEqual([second]);
    expect(selected.withPortAdded({ ...call, cellId: asCellId("B") }).ports).toHaveLength(1);
    expect(selected.withCellAdded(asCellId("A")).ports).toHaveLength(0);
    expect(selected.withCellToggled(asCellId("A")).ports).toHaveLength(0);
    expect(SelectionState.ofJoin(asJoinId("j")).withPortAdded(call).joinIds.size).toBe(0);
    expect(SelectionState.ofPort(call).withPortToggled(call).isEmpty).toBe(true);
  });

  it("distinguishes port directions and array subscripts", () => {
    const selected = SelectionState.ofPort(call)
      .withPortAdded({ ...call, subscript: 1 })
      .withPortAdded({ ...call, kind: "eport" });
    expect(selected.ports).toHaveLength(3);
    expect(selected.hasPort({ ...call })).toBe(true);
    expect(selected.hasPort({ ...call, subscript: 2 })).toBe(false);
  });

  it("highlights the selected port and suppresses the marker when its owner is hidden", () => {
    const doc = CdlDocumentLoader.loadSources([
      { text: readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf8"), fileName: "celltypes.cdl", editable: false },
      { text: readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf8"), fileName: "main.cde", editable: true },
    ]).document;
    const cell = doc.getCell(asCellId("cLogger1"))!;
    const selected = SelectionState.ofPort({ kind: "eport", cellId: cell.id, portName: "eLog", subscript: null });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const renderer = new SvgRenderer(svg);
    renderer.render(doc, defaultCanvasView(), selected);
    const marker = svg.querySelector("circle.port-selected")!;
    expect(Number(marker.getAttribute("cx"))).toBeCloseTo(35 * MM_TO_PX);
    expect(Number(marker.getAttribute("cy"))).toBeCloseTo(18 * MM_TO_PX);
    renderer.render(doc, { ...defaultCanvasView(), hiddenRegionIds: new Set([cell.regionId]) }, selected);
    expect(svg.querySelector(".port-selected")).toBeNull();
  });
});

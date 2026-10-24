/**
 * @vitest-environment happy-dom
 */
// 外部仕様7.4.2 — セル名強調（Emphasize Cell Name）。オンでセル名を大きく表示し、セルタイプ名を隠す。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CellRenderer } from "../../src/renderer/render/cell-renderer";
import { defaultCanvasView, type CanvasView } from "../../src/renderer/render/view";
import type { Cell } from "../../src/renderer/model/cell";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function firstCell(): Cell {
  const doc = CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
  const cell = doc.cellValues()[0];
  if (!cell) throw new Error("fixture has no cell");
  return cell;
}

describe("CellRenderer — cell name emphasis (7.4.2)", () => {
  const renderer = new CellRenderer();

  it("shows the cell name and the celltype name normally by default", () => {
    const cell = firstCell();
    const g = renderer.createElement(cell, { view: defaultCanvasView() });
    expect(g.querySelector(".cell-label")?.textContent).toBe(cell.name);
    expect(g.querySelector(".cell-label.emphasized")).toBeNull();
    expect(g.querySelector(".celltype-label")?.textContent).toBe(cell.celltypeName);
  });

  it("when on, enlarges the cell name and hides the celltype name", () => {
    const cell = firstCell();
    const view: CanvasView = { ...defaultCanvasView(), emphasizeCellName: true };
    const g = renderer.createElement(cell, { view });
    const label = g.querySelector(".cell-label");
    expect(label?.textContent).toBe(cell.name);
    expect(label?.classList.contains("emphasized")).toBe(true);
    expect(g.querySelector(".celltype-label")).toBeNull();
  });

  it("is independent of the region color tab", () => {
    const cell = firstCell();
    const view: CanvasView = {
      ...defaultCanvasView(),
      emphasizeCellName: true,
      regionColors: new Map([[cell.regionId, "#123456"]]),
    };
    const g = renderer.createElement(cell, { view });
    expect(g.querySelector(".region-tab")?.getAttribute("fill")).toBe("#123456");
    expect(g.querySelector(".cell-label.emphasized")).not.toBeNull();
  });
});

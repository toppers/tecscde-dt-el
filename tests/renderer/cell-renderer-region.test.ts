/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.5 — 色分け表示のセルの帯。

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

describe("CellRenderer — region tab (6B.5)", () => {
  const renderer = new CellRenderer();

  it("draws no tab when regionColors is null", () => {
    const g = renderer.createElement(firstCell(), { view: defaultCanvasView() });
    expect(g.querySelector(".region-tab")).toBeNull();
  });

  it("draws a tab filled with the region color, leaving state classes alone", () => {
    const cell = firstCell();
    const view: CanvasView = { ...defaultCanvasView(), regionColors: new Map([[cell.regionId, "#123456"]]) };
    const plain = renderer.createElement(cell, { view: defaultCanvasView() });
    const g = renderer.createElement(cell, { view });
    const tab = g.querySelector(".region-tab");
    expect(tab?.getAttribute("fill")).toBe("#123456");
    expect(g.querySelector(".cell-rect")?.getAttribute("class")).toBe(
      plain.querySelector(".cell-rect")?.getAttribute("class"),
    );
  });

  it("draws no tab for a region without a color (e.g. the root)", () => {
    const cell = firstCell();
    const view: CanvasView = { ...defaultCanvasView(), regionColors: new Map() };
    expect(renderer.createElement(cell, { view }).querySelector(".region-tab")).toBeNull();
  });
});

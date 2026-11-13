import { describe, expect, it } from "vitest";
import { rectangleUnionBoundary, computeRegionOutlines, type OutlineRectangle } from "../../src/renderer/render/region-outlines";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asRegionId } from "../../src/renderer/model/ids";

const length = (segments: readonly { x1: number; y1: number; x2: number; y2: number }[]) =>
  segments.reduce((sum, line) => sum + Math.abs(line.x2 - line.x1) + Math.abs(line.y2 - line.y1), 0);
describe("rectangle union outlines", () => {
  it.each([
    { name: "separated", boxes: [{ x: 0, y: 0, width: 2, height: 2 }, { x: 4, y: 0, width: 2, height: 2 }], perimeter: 16, count: 8 },
    { name: "overlapping", boxes: [{ x: 0, y: 0, width: 4, height: 2 }, { x: 2, y: 0, width: 4, height: 2 }], perimeter: 16, count: 4 },
    { name: "contained", boxes: [{ x: 0, y: 0, width: 6, height: 4 }, { x: 2, y: 1, width: 1, height: 1 }], perimeter: 20, count: 4 },
    { name: "shared edge", boxes: [{ x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 0, width: 2, height: 2 }], perimeter: 12, count: 4 },
    { name: "corner contact", boxes: [{ x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 2, width: 2, height: 2 }], perimeter: 16, count: 6 },
    { name: "duplicate", boxes: [{ x: 0, y: 0, width: 2, height: 2 }, { x: 0, y: 0, width: 2, height: 2 }], perimeter: 8, count: 4 },
  ])("removes internal edges for $name without splitting the input rectangles", ({ boxes, perimeter, count }) => {
    const original = JSON.stringify(boxes);
    const boundary = rectangleUnionBoundary(boxes);
    expect(length(boundary)).toBe(perimeter);
    expect(boundary).toHaveLength(count);
    expect(JSON.stringify(boxes)).toBe(original);
  });

  it("preserves the boundary of a hole and ignores degenerate/nonfinite rectangles", () => {
    const boxes: OutlineRectangle[] = [
      { x: 0, y: 0, width: 6, height: 1 }, { x: 0, y: 5, width: 6, height: 1 },
      { x: 0, y: 1, width: 1, height: 4 }, { x: 5, y: 1, width: 1, height: 4 },
      { x: 0, y: 0, width: 0, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 },
    ];
    const lines = rectangleUnionBoundary(boxes);
    expect(length(lines)).toBe(40);
    expect(lines).toHaveLength(8);
  });
});

describe("region hierarchy outlines", () => {
  it("includes visible descendant cells in ancestors, separates parent/child by margin, and excludes the root", () => {
    let doc = CdlDocumentLoader.loadSingle("region Parent { region Child { cell tUnknown C {}; }; }; cell tUnknown Root {};", "diagram.cdl").document;
    doc = doc.withCell(doc.getCell(asCellId("C"))!.moveTo(20, 30));
    const visible = new Set([asCellId("C"), asCellId("Root")]);
    const outlines = computeRegionOutlines(doc, visible);
    expect(outlines.map((outline) => outline.regionId)).toEqual([asRegionId("::Parent"), asRegionId("::Parent::Child")]);
    const cell = doc.getCell(asCellId("C"))!;
    expect(outlines[0]!.margin).toBe(2);
    expect(outlines[1]!.margin).toBe(1);
    expect(outlines[0]!.rectangles).toEqual([{ x: cell.x - 2, y: cell.y - 2, width: cell.width + 4, height: cell.height + 4 }]);
    expect(outlines[1]!.rectangles).toEqual([{ x: cell.x - 1, y: cell.y - 1, width: cell.width + 2, height: cell.height + 2 }]);
    expect(computeRegionOutlines(doc, new Set())).toEqual([]);
  });

  it("orders siblings deterministically and puts the name on an actual top-left boundary corner", () => {
    let doc = CdlDocumentLoader.loadSingle("region B { cell tUnknown B {}; }; region A { cell tUnknown A {}; cell tUnknown A2 {}; };", "diagram.cdl").document;
    doc = doc.withCell(doc.getCell(asCellId("A"))!.moveTo(50, 10)).withCell(doc.getCell(asCellId("A2"))!.moveTo(10, 50));
    const outlines = computeRegionOutlines(doc, new Set(doc.cellValues().map((cell) => cell.id)));
    expect(outlines.map((outline) => outline.regionId)).toEqual([asRegionId("::A"), asRegionId("::B")]);
    expect(outlines[0]!.labelPosition).toEqual({ x: 49, y: 9 });
    expect(outlines[0]!.rectangles).toHaveLength(2);
  });
});

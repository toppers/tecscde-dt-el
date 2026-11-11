import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { computeRegionOutlines } from "../../src/renderer/render/region-outlines";
import { regionColorMap } from "../../src/renderer/view-state/region-colors";

describe("computeRegionOutlines (Audit #47, 6C.5)", () => {
  it("computes outline segments and label position for non-root region with cells", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask {
        entry sSig e;
      };
      region rOuter {
        cell tTask Task1 {};
      };
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const task = [...doc.cellValues()].find((c) => c.name === "Task1")!;
    const visibleCellIds = new Set([task.id]);
    const colorMap = regionColorMap(doc.regions);

    const outlines = computeRegionOutlines(doc, visibleCellIds, doc.regions, colorMap);
    expect(outlines.length).toBe(1);

    const outline = outlines[0]!;
    expect(outline.regionName).toBe("rOuter");
    expect(outline.segments.length).toBeGreaterThan(0);
    expect(outline.color).toBe(colorMap.get(outline.regionId));
    expect(outline.labelPos.x).toBeLessThan(task.x);
    expect(outline.labelPos.y).toBeLessThan(task.y);
  });

  it("excludes regions that have no visible cells", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask {
        entry sSig e;
      };
      region rEmpty {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const colorMap = regionColorMap(doc.regions);

    const outlines = computeRegionOutlines(doc, new Set(), doc.regions, colorMap);
    expect(outlines).toHaveLength(0);
  });
});

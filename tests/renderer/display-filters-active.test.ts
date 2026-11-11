// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DisplayFilters } from "../../src/renderer/view-state/display-filters";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import { SelectionState, defaultCanvasView } from "../../src/renderer/render/view";

describe("DisplayFilters with activeOnly and Selection visibility (Audit #45, #55)", () => {
  it("initializes activeOnly to false and supports immutable withActiveOnly", () => {
    const filters = DisplayFilters.allVisible();
    expect(filters.activeOnly).toBe(false);

    const activeOnlyFilters = filters.withActiveOnly(true);
    expect(activeOnlyFilters.activeOnly).toBe(true);
    expect(filters.activeOnly).toBe(false);
    expect(filters.equals(activeOnlyFilters)).toBe(false);

    const back = activeOnlyFilters.withActiveOnly(false);
    expect(back.activeOnly).toBe(false);
    expect(filters.equals(back)).toBe(true);
  });

  it("does not render selection outline for cells hidden by activeOnly or region (Audit #55)", () => {
    const cdl = `
      signature sSig { void f(); };
      [active]
      celltype tTask {
        entry sSig e;
      };
      celltype tWorker {
        entry sSig e;
      };
      cell tTask Active1 {};
      cell tWorker Inactive1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const inactiveCell = [...doc.cellValues()].find((c) => c.name === "Inactive1")!;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const renderer = new SvgRenderer(svg);

    // Select the inactive cell
    const selection = SelectionState.ofCells([inactiveCell.id]);

    // View with activeOnly: true
    const view = { ...defaultCanvasView(), activeOnly: true };

    renderer.render(doc, view, selection);

    // Selection overlay should NOT have a rect for the hidden cell
    const selectionOverlay = svg.querySelector("#selection-overlay");
    expect(selectionOverlay).not.toBeNull();
    const rects = selectionOverlay!.querySelectorAll("rect");
    expect(rects.length).toBe(0);

    // When activeOnly: false, selection outline should be rendered
    const viewAll = { ...defaultCanvasView(), activeOnly: false };
    renderer.render(doc, viewAll, selection);
    const rectsAll = selectionOverlay!.querySelectorAll("rect");
    expect(rectsAll.length).toBe(1);
  });
});

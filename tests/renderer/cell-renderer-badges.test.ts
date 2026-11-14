// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { CellRenderer } from "../../src/renderer/render/cell-renderer";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { defaultCanvasView } from "../../src/renderer/render/view";

describe("CellRenderer badges and active class (Audit #44, #48)", () => {
  it("adds active class for active cell and status badges RO, !, U", () => {
    const cdl = `
      signature sSig { void f(); };
      [active]
      celltype tTask {
        call sSig c;
      };
      cell tTask Task1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl", false); // readonly
    const task = [...doc.cellValues()].find((c) => c.name === "Task1")!;

    const renderer = new CellRenderer();
    const group = renderer.createElement(task, { view: defaultCanvasView(), doc });

    const rect = group.querySelector(".cell-rect");
    expect(rect).not.toBeNull();
    // Classes should include active and readonly
    expect(rect!.classList.contains("active")).toBe(true);
    expect(rect!.classList.contains("readonly")).toBe(true);

    // Badges group
    const badges = group.querySelector(".cell-status-badges");
    expect(badges).not.toBeNull();

    // Task1 is readonly, has unconnected call port c, but not unresolved -> should have RO and U
    const badgeRO = badges!.querySelector(".badge-ro");
    expect(badgeRO).not.toBeNull();

    const badgeU = badges!.querySelector(".badge-u");
    expect(badgeU).not.toBeNull();

    const badgeIncomplete = badges!.querySelector(".badge-incomplete");
    expect(badgeIncomplete).toBeNull();
  });
});

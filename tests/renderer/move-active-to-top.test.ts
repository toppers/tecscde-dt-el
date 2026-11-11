import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import {
  canMoveActiveToTop,
  prepareMoveActiveToTop,
  MoveActiveCellsToTopCommand,
} from "../../src/renderer/commands/move-active-to-top";

describe("moveActiveToTop (Audit #58, 6C.4)", () => {
  it("evaluates canMoveActiveToTop based on active and editable cells", () => {
    const cdl1 = `
      signature sSig { void f(); };
      [active]
      celltype tTask {
        entry sSig e;
      };
      cell tTask Task1 {};
    `;
    const { document: doc1 } = CdlDocumentLoader.loadSingle(cdl1, "main.cdl");
    expect(canMoveActiveToTop(doc1)).toBe(true);

    const cdl2 = `
      signature sSig { void f(); };
      celltype tWorker {
        entry sSig e;
      };
      cell tWorker Worker1 {};
    `;
    const { document: doc2 } = CdlDocumentLoader.loadSingle(cdl2, "main.cdl");
    expect(canMoveActiveToTop(doc2)).toBe(false);

    // Readonly active cell should not enable
    const { document: docReadonly } = CdlDocumentLoader.loadSingle(cdl1, "main.cdl", false);
    expect(canMoveActiveToTop(docReadonly)).toBe(false);
  });

  it("plans placement on top row (y=10) without overlap", () => {
    const cdl = `
      signature sSig { void f(); };
      [active]
      celltype tTask {
        entry sSig e;
      };
      cell tTask Task1 {};
      cell tTask Task2 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.success).toBe(true);
    expect(plan.moves.size).toBe(2);

    const task1 = [...doc.cellValues()].find((c) => c.name === "Task1")!;
    const task2 = [...doc.cellValues()].find((c) => c.name === "Task2")!;
    const task1Move = plan.moves.get(task1.id);
    const task2Move = plan.moves.get(task2.id);
    expect(task1Move).toBeDefined();
    expect(task2Move).toBeDefined();
    expect(task1Move!.y).toBe(10);
    expect(task2Move!.y).toBe(10);
    expect(task1Move!.x).toBe(10);
    expect(task2Move!.x).toBe(65); // 10 + 55

    // Command applies the plan
    const cmd = new MoveActiveCellsToTopCommand(plan);
    const nextDoc = cmd.apply(doc);
    expect(nextDoc.getCell(task1.id)!.x).toBe(10);
    expect(nextDoc.getCell(task1.id)!.y).toBe(10);
    expect(nextDoc.getCell(task2.id)!.x).toBe(65);
    expect(nextDoc.getCell(task2.id)!.y).toBe(10);
  });

  it("spills to next row if row is blocked by obstacles", () => {
    const cdl = `
      signature sSig { void f(); };
      [active]
      celltype tTask {
        entry sSig e;
      };
      celltype tObstacle {
        entry sSig e;
      };
      cell tTask Task1 {};
      cell tObstacle Obs1 {};
    `;
    // We will place Obs1 at (65, 10) to block the second slot
    const { document: initialDoc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const obs = [...initialDoc.cellValues()].find((c) => c.name === "Obs1")!;
    const task1 = [...initialDoc.cellValues()].find((c) => c.name === "Task1")!;
    const doc = initialDoc.withCell(obs.moveTo(65, 10));

    const plan = prepareMoveActiveToTop(doc);
    expect(plan.success).toBe(true);
    const task1Move = plan.moves.get(task1.id);
    expect(task1Move!.x).toBe(10);
    expect(task1Move!.y).toBe(10);
    expect(plan.spilledCellIds).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { isActiveCell } from "../../src/renderer/model/active-cell";

describe("isActiveCell", () => {
  it("detects active celltypes from [active] specifier", () => {
    const cdl = `
      [active]
      celltype tTask {
        entry sTask eTask;
      };

      [singleton, active]
      celltype tServer {
        entry sServer eServer;
      };

      celltype tWorker {
        entry sWorker eWorker;
      };

      cell tTask Task1 {};
      cell tServer Server1 {};
      cell tWorker Worker1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const task = doc.cellValues().find((c) => c.name === "Task1");
    const server = doc.cellValues().find((c) => c.name === "Server1");
    const worker = doc.cellValues().find((c) => c.name === "Worker1");

    expect(task).toBeDefined();
    expect(server).toBeDefined();
    expect(worker).toBeDefined();

    expect(isActiveCell(doc, task!)).toBe(true);
    expect(isActiveCell(doc, server!)).toBe(true);
    expect(isActiveCell(doc, worker!)).toBe(false);
  });

  it("returns false for unresolved celltypes", () => {
    const cdl = `
      cell tUnknown Unknown1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const cell = doc.cellValues().find((c) => c.name === "Unknown1");
    expect(cell).toBeDefined();
    expect(isActiveCell(doc, cell!)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { deriveCellVisualState } from "../../src/renderer/render/cell-visual-state";

describe("deriveCellVisualState", () => {
  it("derives states for normal complete cell", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tServer {
        entry sSig e;
      };
      celltype tClient {
        call sSig c;
      };
      cell tServer Server {};
      cell tClient Client {
        c = Server.e;
      };
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const client = doc.cellValues().find((c) => c.name === "Client")!;
    const server = doc.cellValues().find((c) => c.name === "Server")!;

    const clientState = deriveCellVisualState(doc, client);
    expect(clientState.readOnly).toBe(false);
    expect(clientState.incompleteReasons).toHaveLength(0);
    expect(clientState.unconnectedCallPortIds).toEqual([]);

    const serverState = deriveCellVisualState(doc, server);
    expect(serverState.readOnly).toBe(false);
    expect(serverState.incompleteReasons).toHaveLength(0);
    expect(serverState.unconnectedCallPortIds).toEqual([]);
  });

  it("derives readOnly for non-editable cell", () => {
    const cdl = `
      celltype tFoo {};
      cell tFoo Foo {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl", false);
    const foo = doc.cellValues().find((c) => c.name === "Foo")!;
    const state = deriveCellVisualState(doc, foo);
    expect(state.readOnly).toBe(true);
  });

  it("derives incomplete and null unconnectedCallPortIds for unresolved celltype", () => {
    const cdl = `
      cell tUnresolved Bar {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const bar = doc.cellValues().find((c) => c.name === "Bar")!;
    const state = deriveCellVisualState(doc, bar);
    expect(state.incompleteReasons).toContain("セルタイプ未解決");
    expect(state.unconnectedCallPortIds).toBeNull();
  });

  it("derives unconnectedCallPortIds for unconnected call ports (including optional)", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tClient {
        call sSig c1;
        call sSig c2;
      };
      cell tClient Client {
      };
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const client = doc.cellValues().find((c) => c.name === "Client")!;
    const state = deriveCellVisualState(doc, client);
    expect(state.incompleteReasons).toHaveLength(0);
    expect(state.unconnectedCallPortIds).toEqual(["c1", "c2"]);
  });
});

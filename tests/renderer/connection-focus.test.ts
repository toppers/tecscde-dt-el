import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { resolveHighlightedJoinIds } from "../../src/renderer/render/connection-focus";
import { SelectionState, type SelectedPort } from "../../src/renderer/render/view";

describe("Connection focus and port selection (Audit #46, #21)", () => {
  it("resolves highlighted joins from selected call port and entry port directly", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tServer {
        entry sSig e1;
        entry sSig e2;
      };
      celltype tClient {
        call sSig c1;
        call sSig c2;
      };
      cell tServer Server {};
      cell tClient Client1 {
        c1 = Server.e1;
      };
      cell tClient Client2 {
        c1 = Server.e1;
      };
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const client1 = [...doc.cellValues()].find((c) => c.name === "Client1")!;
    const server = [...doc.cellValues()].find((c) => c.name === "Server")!;

    // Call port c1 on Client1
    const callPort: SelectedPort = {
      cellId: client1.id,
      portName: "c1",
      kind: "cport",
      subscript: null,
    };
    const callJoins = resolveHighlightedJoinIds(doc, [callPort]);
    expect(callJoins.size).toBe(1);

    // Entry port e1 on Server has 2 joins connected to it
    const entryPort: SelectedPort = {
      cellId: server.id,
      portName: "e1",
      kind: "eport",
      subscript: null,
    };
    const entryJoins = resolveHighlightedJoinIds(doc, [entryPort]);
    expect(entryJoins.size).toBe(2);

    // Port with no joins returns empty set
    const emptyPort: SelectedPort = {
      cellId: server.id,
      portName: "e2",
      kind: "eport",
      subscript: null,
    };
    const emptyJoins = resolveHighlightedJoinIds(doc, [emptyPort]);
    expect(emptyJoins.size).toBe(0);
  });

  it("supports SelectionState.ofPort and maintains port selection", () => {
    const port: SelectedPort = {
      cellId: "c1" as any,
      portName: "p1",
      kind: "cport",
      subscript: null,
    };
    const sel = SelectionState.ofPort(port);
    expect(sel.ports).toHaveLength(1);
    expect(sel.ports[0]).toEqual(port);

    const empty = SelectionState.empty();
    expect(empty.ports).toHaveLength(0);
  });
});

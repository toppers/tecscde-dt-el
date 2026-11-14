import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { resolveHighlightedJoinIds } from "../../src/renderer/render/connection-focus";
import { SelectionState, type SelectedPort } from "../../src/renderer/render/view";
import { Cell } from "../../src/renderer/model/cell";
import { CPort, EPort } from "../../src/renderer/model/port";
import { asCellId, asJoinId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { Join } from "../../src/renderer/model/join";

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

  it("resolves highlighted joins specifically for array entry port elements with subscript", () => {
    const serverId = asCellId("cServer");
    const client0Id = asCellId("cClient0");
    const client1Id = asCellId("cClient1");

    const e0 = EPort.create({
      name: "e",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 5,
      subscript: 0,
      arraySize: 2,
    });
    const e1 = EPort.create({
      name: "e",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 10,
      subscript: 1,
      arraySize: 2,
    });

    const c0 = CPort.create({
      name: "c",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 5,
      subscript: null,
      arraySize: null,
    });
    const c1 = CPort.create({
      name: "c",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 5,
      subscript: null,
      arraySize: null,
    });

    const j0Id = asJoinId("j0");
    const j1Id = asJoinId("j1");

    const join0 = Join.create(j0Id, client0Id, c0, serverId, e0, []);
    const join1 = Join.create(j1Id, client1Id, c1, serverId, e1, []);

    const server = Cell.create({
      id: serverId,
      name: "cServer",
      celltypeName: "tServer",
      x: 50,
      y: 0,
      width: 25,
      height: 25,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: [],
      eports: [e0.withJoin(j0Id), e1.withJoin(j1Id)],
      attrs: {},
      celltypeUnresolved: false,
    });

    const client0 = Cell.create({
      id: client0Id,
      name: "cClient0",
      celltypeName: "tClient",
      x: 0,
      y: 0,
      width: 25,
      height: 25,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: [c0.withJoin(j0Id)],
      eports: [],
      attrs: {},
      celltypeUnresolved: false,
    });

    const client1 = Cell.create({
      id: client1Id,
      name: "cClient1",
      celltypeName: "tClient",
      x: 0,
      y: 30,
      width: 25,
      height: 25,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: [c1.withJoin(j1Id)],
      eports: [],
      attrs: {},
      celltypeUnresolved: false,
    });

    const doc = TecscdeDocument.empty()
      .withCell(server)
      .withCell(client0)
      .withCell(client1)
      .withJoin(join0)
      .withJoin(join1);

    // e[1] を選択
    const e1Port: SelectedPort = {
      cellId: serverId,
      portName: "e",
      kind: "eport",
      subscript: 1,
    };
    const e1Joins = resolveHighlightedJoinIds(doc, [e1Port]);
    expect(e1Joins.size).toBe(1);
    expect(e1Joins.has(j1Id)).toBe(true);
    expect(e1Joins.has(j0Id)).toBe(false);

    // e[0] を選択
    const e0Port: SelectedPort = {
      cellId: serverId,
      portName: "e",
      kind: "eport",
      subscript: 0,
    };
    const e0Joins = resolveHighlightedJoinIds(doc, [e0Port]);
    expect(e0Joins.size).toBe(1);
    expect(e0Joins.has(j0Id)).toBe(true);
    expect(e0Joins.has(j1Id)).toBe(false);
  });
});

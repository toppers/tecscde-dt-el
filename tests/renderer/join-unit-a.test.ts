import { describe, expect, it } from "vitest";
import { Join } from "../../src/renderer/model/join";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { CPort, EPort } from "../../src/renderer/model/port";
import { CdlDocumentBuilder } from "../../src/renderer/cdl/cst";

describe("Join model subscripts (Unit A)", () => {
  const cellId = asCellId("c1");
  const eportCellId = asCellId("c2");
  const joinId = asJoinId("j1");

  it("captures cport and eport subscripts on Join.create", () => {
    const cportWithSub = CPort.create({
      name: "cPort",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 10,
      subscript: 2,
      arraySize: 5,
    });
    const eportWithSub = EPort.create({
      name: "ePort",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 10,
      subscript: 4,
      arraySize: 10,
    });

    const join = Join.create(joinId, cellId, cportWithSub, eportCellId, eportWithSub, []);
    expect(join.cportSubscript).toBe(2);
    expect(join.eportSubscript).toBe(4);
  });

  it("defaults subscripts to null for non-array ports", () => {
    const cportPlain = CPort.create({
      name: "cPlain",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 10,
    });
    const eportPlain = EPort.create({
      name: "ePlain",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 10,
    });

    const join = Join.create(joinId, cellId, cportPlain, eportCellId, eportPlain, []);
    expect(join.cportSubscript).toBeNull();
    expect(join.eportSubscript).toBeNull();
  });

  it("preserves subscripts across moveBar and withBars", () => {
    const cport = CPort.create({
      name: "cP",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 10,
      subscript: 1,
    });
    const eport = EPort.create({
      name: "eP",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 10,
      subscript: 3,
    });

    const join = Join.create(joinId, cellId, cport, eportCellId, eport, [
      { direction: "H", fixed: 10, from: 0, to: 20 },
    ]);

    const withBarsResult = join.withBars([
      { direction: "V", fixed: 15, from: 5, to: 25 },
    ]);
    expect(withBarsResult.cportSubscript).toBe(1);
    expect(withBarsResult.eportSubscript).toBe(3);

    const moved = join.moveBar(0, 15);
    expect(moved.cportSubscript).toBe(1);
    expect(moved.eportSubscript).toBe(3);
  });

  it("updates subscripts with withSubscripts and returns self when unchanged", () => {
    const cport = CPort.create({
      name: "cP",
      signature: "sSig",
      edgeSide: "RIGHT",
      offset: 10,
      subscript: 0,
    });
    const eport = EPort.create({
      name: "eP",
      signature: "sSig",
      edgeSide: "LEFT",
      offset: 10,
      subscript: 1,
    });

    const join = Join.create(joinId, cellId, cport, eportCellId, eport, []);
    const same = join.withSubscripts(0, 1);
    expect(same).toBe(join);

    const updated = join.withSubscripts(2, 5);
    expect(updated).not.toBe(join);
    expect(updated.cportSubscript).toBe(2);
    expect(updated.eportSubscript).toBe(5);
    expect(updated.id).toBe(join.id);
    expect(updated.cportName).toBe(join.cportName);
    expect(updated.eportName).toBe(join.eportName);
  });
});

describe("CST join rhs subscript expression parsing (Unit A)", () => {
  it("parses valid eport subscript index (integer constant expression)", () => {
    const cdl = `
      celltype tTarget { entry sSig ePort[5]; };
      celltype tClient { call sSig cPort; };
      cell tTarget target {};
      cell tClient client {
        cPort = target.ePort[2];
      };
    `;
    const parsed = CdlDocumentBuilder.build(cdl);
    const clientCell = parsed.cells.find((c) => c.cellName === "client");
    expect(clientCell).toBeDefined();
    expect(clientCell?.joins.length).toBe(1);
    const join = clientCell!.joins[0]!;
    expect(join.cport).toBe("cPort");
    expect(join.targetCell).toBe("target");
    expect(join.eport).toBe("ePort");
    expect(join.eportIndex).toBe(2);
    expect(join.eportSubscriptInvalid).toBeUndefined();
  });

  it("evaluates constant expression in eport subscript", () => {
    const cdl = `
      cell tClient client {
        cPort = target.ePort[1 + 2 * 3];
      };
    `;
    const parsed = CdlDocumentBuilder.build(cdl);
    const join = parsed.cells[0]?.joins[0];
    expect(join?.eportIndex).toBe(7); // 1 + 6 = 7
    expect(join?.eportSubscriptInvalid).toBeUndefined();
  });

  it("handles left omitted subscript with right subscript index", () => {
    const cdl = `
      cell tClient client {
        cPort[] = target.ePort[3];
      };
    `;
    const parsed = CdlDocumentBuilder.build(cdl);
    const join = parsed.cells[0]?.joins[0];
    expect(join?.cport).toBe("cPort");
    expect(join?.cportIndex).toBe(0);
    expect(join?.subscriptOmitted).toBe(true);
    expect(join?.eportIndex).toBe(3);
  });

  it("classifies omitted right subscript ePort[] as invalid subscript join (not attribute)", () => {
    const cdl = `
      cell tClient client {
        cPort = target.ePort[];
      };
    `;
    const parsed = CdlDocumentBuilder.build(cdl);
    const clientCell = parsed.cells[0];
    expect(clientCell?.attrs.length).toBe(0); // Not misclassified as attr
    expect(clientCell?.joins.length).toBe(1);
    const join = clientCell!.joins[0]!;
    expect(join.targetCell).toBe("target");
    expect(join.eport).toBe("ePort");
    expect(join.eportIndex).toBeUndefined();
    expect(join.eportSubscriptInvalid).toBe("");
  });

  it("classifies negative or unresolvable right subscript as invalid subscript join", () => {
    const cdl = `
      cell tClient client {
        c1 = target.ePort[-1];
        c2 = target.ePort[UNKNOWN_MACRO];
      };
    `;
    const parsed = CdlDocumentBuilder.build(cdl);
    const joins = parsed.cells[0]?.joins;
    expect(joins?.length).toBe(2);

    expect(joins?.[0]?.cport).toBe("c1");
    expect(joins?.[0]?.eportIndex).toBeUndefined();
    expect(joins?.[0]?.eportSubscriptInvalid).toBe("-1");

    expect(joins?.[1]?.cport).toBe("c2");
    expect(joins?.[1]?.eportIndex).toBeUndefined();
    expect(joins?.[1]?.eportSubscriptInvalid).toBe("UNKNOWN_MACRO");
  });
});
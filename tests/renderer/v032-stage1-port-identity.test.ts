import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asPortId } from "../../src/renderer/model/ids";
import { CPort, EPort } from "../../src/renderer/model/port";
import { portPosition } from "../../src/renderer/model/geometry";
import { HitTester } from "../../src/renderer/render/hit-tester";
import { defaultCanvasView, resolveSelectedPort, SelectionState } from "../../src/renderer/render/view";
import { resolveHighlightedJoinIds } from "../../src/renderer/render/connection-focus";

describe("V0.3.2 Stage 1: PortId と arrayKind のモデル基盤 (6-6)", () => {
  it("CPort/EPort は固有の PortId を持ち、withEdge/withSubscript/withJoin/withoutJoin 後も id と arrayKind を維持する", () => {
    const c1 = CPort.create({
      name: "cArr",
      signature: "sA",
      edgeSide: "LEFT",
      offset: 5,
      subscript: 0,
      arraySize: null,
      arrayKind: "variable",
    });
    const c2 = CPort.create({
      name: "cArr",
      signature: "sA",
      edgeSide: "LEFT",
      offset: 9,
      subscript: 1,
      arraySize: null,
      arrayKind: "variable",
    });
    expect(c1.id).not.toBe(c2.id);
    expect(c1.arrayKind).toBe("variable");

    const moved = c1.withEdge("RIGHT", 10);
    expect(moved.id).toBe(c1.id);
    expect(moved.arrayKind).toBe("variable");

    const reindexed = moved.withSubscript(2);
    expect(reindexed.id).toBe(c1.id);
    expect(reindexed.subscript).toBe(2);
    expect(reindexed.arrayKind).toBe("variable");

    const explicitId = asPortId("custom:eport:1");
    const e1 = EPort.create({
      id: explicitId,
      name: "eArr",
      signature: "sA",
      edgeSide: "RIGHT",
      offset: 5,
      subscript: 0,
      arraySize: 2,
      arrayKind: "fixed",
    });
    expect(e1.id).toBe(explicitId);
    expect(e1.withSubscript(1).id).toBe(explicitId);
    expect(e1.withSubscript(1).arrayKind).toBe("fixed");
  });

  it("CDL 読み込みで 非配列・固定長・可変長・未解決 の 4 種を arrayKind で区別し、全要素に固有 PortId を振る", () => {
    const cdl = `
signature sSig { void f(void); };
celltype tTarget {
  entry sSig eSingle;
  entry sSig eFixed[2];
  entry sSig eVar[];
  entry sSig eUnres[UNKNOWN_N];
};
celltype tCaller {
  call sSig cSingle;
  call sSig cFixed[3];
  call sSig cVar[];
  call sSig cUnres[UNKNOWN_M];
};
cell tTarget Target {};
cell tCaller Caller {
  cVar[0] = Target.eVar[0];
  cVar[1] = Target.eVar[1];
};
`;
    const { document: doc } = CdlDocumentLoader.loadSources([{ text: cdl, fileName: "test.cdl", editable: true }]);
    const caller = doc.cellValues().find((c) => c.name === "Caller")!;
    const target = doc.cellValues().find((c) => c.name === "Target")!;

    // 呼び口 4 種
    const cSingle = caller.findCPort("cSingle", null)!;
    expect(cSingle.arrayKind).toBe("none");

    const cFixed = caller.cports.filter((p) => p.name === "cFixed");
    expect(cFixed).toHaveLength(3);
    expect(cFixed.every((p) => p.arrayKind === "fixed" && p.arraySize === 3)).toBe(true);
    expect(new Set(cFixed.map((p) => p.id)).size).toBe(3);

    const cVar = caller.cports.filter((p) => p.name === "cVar");
    expect(cVar).toHaveLength(2);
    expect(cVar.every((p) => p.arrayKind === "variable" && p.arraySize === null)).toBe(true);
    expect(new Set(cVar.map((p) => p.id)).size).toBe(2);

    const cUnres = caller.findCPort("cUnres", null)!;
    expect(cUnres.arrayKind).toBe("unresolved");
    expect(cUnres.arraySize).toBeNull();
    expect(cUnres.subscript).toBeNull();

    // 受け口 4 種
    expect(target.findEPort("eSingle", null)!.arrayKind).toBe("none");
    expect(target.eports.filter((p) => p.name === "eFixed").every((p) => p.arrayKind === "fixed")).toBe(true);
    expect(target.eports.filter((p) => p.name === "eVar").every((p) => p.arrayKind === "variable")).toBe(true);
    expect(target.findEPort("eUnres", null)!.arrayKind).toBe("unresolved");

    // findCPortById / findEPortById
    expect(caller.findCPortById(cVar[1]!.id)).toBe(cVar[1]);
    expect(target.findEPortById(target.eports[0]!.id)).toBe(target.eports[0]);
  });

  it("HitTester・SelectionState・resolveSelectedPort・resolveHighlightedJoinIds が PortId で添字変更後も同一要素を追跡する", () => {
    const cdl = `
signature sSig { void f(void); };
celltype tTarget { entry sSig e; };
celltype tCaller { call sSig cVar[]; };
cell tTarget Target {};
cell tCaller Caller {
  cVar[0] = Target.e;
  cVar[1] = Target.e;
};
`;
    const { document: doc } = CdlDocumentLoader.loadSources([{ text: cdl, fileName: "test.cdl", editable: true }]);
    const caller = doc.cellValues().find((c) => c.name === "Caller")!;
    const p1 = caller.findCPort("cVar", 1)!;

    const tester = new HitTester(doc, defaultCanvasView());
    const hit = tester.hitTest(portPosition(caller, p1));
    expect(hit.kind).toBe("cport");
    if (hit.kind !== "cport") throw new Error("expected cport hit");
    expect(hit.portId).toBe(p1.id);

    const sel = SelectionState.ofPort(hit);
    expect(sel.hasPort(hit)).toBe(true);
    expect(resolveHighlightedJoinIds(doc, sel.ports)).toEqual(new Set([p1.joinId!]));

    // 添字を 1 → 2 に繰り上げても、同じ PortId を保持する選択は新添字の要素を追跡する
    const reindexedCell = caller.withCPort(p1.withSubscript(2));
    const updatedDoc = doc.withCell(reindexedCell);
    const resolved = resolveSelectedPort(updatedDoc, hit);
    expect(resolved?.port.id).toBe(p1.id);
    expect(resolved?.port.subscript).toBe(2);
    expect(resolveHighlightedJoinIds(updatedDoc, sel.ports)).toEqual(new Set([p1.joinId!]));
  });
});

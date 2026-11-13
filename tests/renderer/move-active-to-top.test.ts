import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { Cell } from "../../src/renderer/model/cell";
import { asCellId } from "../../src/renderer/model/ids";
import { autoRouteBars, portPosition } from "../../src/renderer/model/geometry";
import { History } from "../../src/renderer/commands/history";
import { canMoveActiveToTop, MoveActiveCellsToTopCommand, prepareMoveActiveToTop } from "../../src/renderer/commands/move-active-to-top";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import { TecscdeDocument as DocumentModel } from "../../src/renderer/model/document";
import { PaperSpec } from "../../src/renderer/model/paper";

const types = "signature sX { void run(void); }; [active] celltype tActive { call sX c; entry sX e; }; celltype tPlain { call sX c; entry sX e; };";
function load(cells: string) { return CdlDocumentLoader.loadSingle(types + cells, "/main.cdl").document; }
function place(doc: TecscdeDocument, name: string, x: number, y: number, more: Partial<Cell> = {}) {
  const before = doc.getCell(asCellId(name))!;
  return doc.withCell(Cell.create({ ...before, ...more, x, y }));
}
const positions = (doc: TecscdeDocument) => doc.cellValues().map((cell) => ({ id: cell.id, x: cell.x, y: cell.y }));

describe("active top placement", () => {
  it("uses stable document enumeration rather than names or old coordinates", () => {
    let doc = load("cell tActive B {}; cell tActive A {};");
    doc = place(place(doc, "B", 200, 140), "A", 30, 80);
    const before = positions(doc);
    expect(canMoveActiveToTop(doc)).toBe(true);
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.kind).toBe("ready");
    expect(plan.orderedCellIds).toEqual(["B", "A"]);
    expect(plan.topRowCellIds).toEqual(["B", "A"]);
    expect(plan.spilledCellIds).toEqual([]);
    const next = new MoveActiveCellsToTopCommand(plan).apply(doc);
    expect(positions(next)).toEqual([{ id: "B", x: 10, y: 10 }, { id: "A", x: 65, y: 10 }]);
    expect(positions(doc)).toEqual(before);
    expect(next.paper).toBe(doc.paper);
  });

  it("holds nonactive and read-only active cells fixed as obstacles", () => {
    let doc = load("cell tActive A {}; cell tActive RO {}; cell tPlain Fixed {};");
    doc = place(place(place(doc, "A", 100, 100), "RO", 10, 10, { editable: false }), "Fixed", 65, 10);
    const next = new MoveActiveCellsToTopCommand(prepareMoveActiveToTop(doc)).apply(doc);
    expect(next.getCell(asCellId("A"))).toMatchObject({ x: 120, y: 10 });
    expect(next.getCell(asCellId("RO"))).toBe(doc.getCell(asCellId("RO")));
    expect(next.getCell(asCellId("Fixed"))).toBe(doc.getCell(asCellId("Fixed")));
  });

  it("spills to y=40 only after the top grid row has no collision-free candidate", () => {
    let doc = load("cell tActive A {}; cell tPlain Wall {};");
    doc = place(place(doc, "A", 100, 100), "Wall", 0, 0, { width: 277, height: 30 });
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.kind).toBe("ready");
    expect(plan.topRowCellIds).toEqual([]);
    expect(plan.spilledCellIds).toEqual(["A"]);
    expect(new MoveActiveCellsToTopCommand(plan).apply(doc).getCell(asCellId("A"))).toMatchObject({ x: 10, y: 40 });
  });

  it("rejects the entire plan if any target cannot fit without overlap", () => {
    let doc = load("cell tActive A {}; cell tActive B {}; cell tPlain Wall {};");
    doc = place(doc, "Wall", 0, 0, { width: 277, height: 190 });
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.kind).toBe("failed");
    expect(plan.reason).toBeTruthy();
    expect(plan.moves).toEqual([]);
    expect(new MoveActiveCellsToTopCommand(plan).apply(doc)).toBe(doc);
    expect(History.begin(doc).commit(new MoveActiveCellsToTopCommand(plan)).canUndo).toBe(false);
  });

  it("rejects an oversized target with finite scanning and leaves all dimensions intact", () => {
    let doc = load("cell tActive A {};");
    doc = place(doc, "A", 10, 10, { width: 300 });
    expect(prepareMoveActiveToTop(doc).kind).toBe("failed");
    expect(doc.getCell(asCellId("A"))!.width).toBe(300);
  });

  it("reports no target for inactive or read-only-only documents", () => {
    const inactive = load("cell tPlain P {};");
    const readonly = place(load("cell tActive R {};"), "R", 90, 90, { editable: false });
    for (const doc of [inactive, readonly]) {
      expect(canMoveActiveToTop(doc)).toBe(false);
      expect(prepareMoveActiveToTop(doc).kind).toBe("empty");
    }
  });

  it("returns unchanged for already placed targets and does not rewrite their manual routes", () => {
    let doc = load("cell tActive A { c = B.e; }; cell tPlain B {};");
    doc = place(place(doc, "A", 10, 10), "B", 150, 100);
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.kind).toBe("unchanged");
    expect(plan.joinRoutes).toEqual([]);
    expect(new MoveActiveCellsToTopCommand(plan).apply(doc)).toBe(doc);
  });

  it("rejects stale target, obstacle, permission and port preconditions by value", () => {
    let doc = load("cell tActive A {}; cell tPlain B {};");
    doc = place(place(doc, "A", 180, 100), "B", 65, 10);
    const command = new MoveActiveCellsToTopCommand(prepareMoveActiveToTop(doc));
    const changed = [place(doc, "B", 10, 10), place(doc, "A", 180, 100, { editable: false }), doc.withoutCell(asCellId("A")),
      doc.withCell(doc.getCell(asCellId("A"))!.withEPort(doc.getCell(asCellId("A"))!.eports[0]!.withEdge("TOP", 11))),
      doc.withCell(Cell.create({ ...doc.getCell(asCellId("B"))!, id: asCellId("Added"), name: "Added" })),
      DocumentModel.build({ cells: new Map(doc.cellValues().map((cell) => [cell.id, cell])),
        joins: new Map(doc.joinValues().map((join) => [join.id, join])), celltypes: new Map(doc.celltypeValues().map((type) => [type.name, type])),
        regions: doc.regions, paper: PaperSpec.create("A3"), toolInfoTecsgen: doc.toolInfoTecsgen,
        referenceFiles: doc.referenceFiles, editingFileName: doc.editingFileName, primarySourceKey: doc.primarySourceKey,
        sourceOrder: doc.sourceOrder, unknownToolInfoTecscde: doc.unknownToolInfoTecscde,
        preservedImports: doc.preservedImports, sourceTemplate: doc.sourceTemplate, sourceTemplates: doc.sourceTemplates,
      })];
    for (const next of changed) expect(command.apply(next)).toBe(next);
    const equal = doc.withCell(Cell.create({ ...doc.getCell(asCellId("B"))! }));
    expect(command.apply(equal)).not.toBe(equal);
  });

  it("plans routes from all final positions and restores positions and routes with one Undo/Redo", () => {
    let doc = load("cell tActive A { c = B.e; }; cell tActive B {}; cell tPlain C { c = D.e; }; cell tPlain D {};");
    doc = place(place(place(place(doc, "A", 150, 100), "B", 10, 100), "C", 160, 160), "D", 220, 160);
    const oldRoutes = doc.joinValues().map((join) => ({ id: join.id, bars: join.bars }));
    const plan = prepareMoveActiveToTop(doc);
    const command = new MoveActiveCellsToTopCommand(plan);
    const history = History.begin(doc).commit(command);
    const final = history.current;
    expect(history.past).toHaveLength(1);
    const a = final.getCell(asCellId("A"))!, b = final.getCell(asCellId("B"))!;
    const join = final.joinValues().find((entry) => entry.cellId === a.id)!;
    expect(join.bars).toEqual(autoRouteBars(portPosition(a, a.findCPort(join.cportName)!), a.findCPort(join.cportName)!.edgeSide,
      portPosition(b, b.findEPort(join.eportName)!), b.findEPort(join.eportName)!.edgeSide, final.cellValues()));
    expect(final.joinValues().find((entry) => entry.cellId === "C")!.bars).toBe(doc.joinValues().find((entry) => entry.cellId === "C")!.bars);
    expect(positions(history.undo().current)).toEqual(positions(doc));
    expect(history.undo().current.joinValues().map((entry) => ({ id: entry.id, bars: entry.bars }))).toEqual(oldRoutes);
    expect(positions(history.undo().redo().current)).toEqual(positions(final));
    expect(command.apply(final)).toBe(final);
  });

  it("reroutes a connection to a fixed read-only endpoint without moving or editing that endpoint", () => {
    let doc = load("cell tActive A { c = B.e; }; cell tPlain B {};");
    doc = place(place(doc, "A", 180, 100), "B", 150, 100, { editable: false });
    const plan = prepareMoveActiveToTop(doc);
    expect(plan.kind).toBe("ready");
    expect(plan.joinRoutes).toHaveLength(1);
    const next = new MoveActiveCellsToTopCommand(plan).apply(doc);
    expect(next.getCell(asCellId("B"))).toBe(doc.getCell(asCellId("B")));
    expect(next.joinValues()[0]!.eportCellId).toBe("B");
    expect(Object.isFrozen(plan.moves)).toBe(true);
    expect(Object.isFrozen(plan.moves[0]!.to)).toBe(true);
    expect(Object.isFrozen(plan.joinRoutes[0]!.after[0])).toBe(true);
  });
});

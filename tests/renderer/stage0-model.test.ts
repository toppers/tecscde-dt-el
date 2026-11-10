import { describe, expect, it } from "vitest";
import { CdlDocumentLoader, type CdlSource } from "../../src/renderer/cdl/document-builder";
import { History } from "../../src/renderer/commands/history";
import { Command } from "../../src/renderer/commands/command";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId } from "../../src/renderer/model/ids";

const source = (name: string, text = "", editable = true): CdlSource => ({
  fileName: `${name}.cdl`, sourcePath: `/project/${name}.cdl`, text, editable,
});

describe("stage 0 explicit source roles", () => {
  it("retains parsing order and the explicitly selected primary source", () => {
    const a = source("a", 'import("a-types.cdl"); cell tX cA {};');
    const b = source("b", 'import("b-types.cdl"); cell tX cB {};');
    const doc = CdlDocumentLoader.loadSources([a, b], { primarySourceKey: a.sourcePath }).document;
    expect(doc.primarySourceKey).toBe(a.sourcePath);
    expect(doc.editingFileName).toBe(a.sourcePath);
    expect(doc.sourceOrder).toEqual([a.sourcePath, b.sourcePath]);
    expect(doc.preservedImports).toEqual(['import("a-types.cdl");']);
    expect(doc.sourceTemplate?.text).toBe(a.text);
    expect(doc.referenceFiles).toEqual(["b.cdl"]);
    expect(doc.withCell(doc.getCell(asCellId("cA"))!.moveTo(55, 66)).sourceOrder).toEqual(doc.sourceOrder);
    expect(doc.withoutCell(asCellId("cA")).primarySourceKey).toBe(a.sourcePath);
  });

  it("keeps a read-only primary without borrowing another source's template or imports", () => {
    const a = source("a", 'import("a-types.cdl");', false);
    const b = source("b", 'import("b-types.cdl");');
    const doc = CdlDocumentLoader.loadSources([a, b], { primarySourceKey: a.sourcePath }).document;
    expect(doc.primarySourceKey).toBe(a.sourcePath);
    expect(doc.sourceTemplate).toBeUndefined();
    expect(doc.preservedImports).toEqual(['import("a-types.cdl");']);
  });

  it("distinguishes an explicit absent primary from the legacy omitted option", () => {
    const a = source("a", 'import("types.cdl");');
    const doc = CdlDocumentLoader.loadSources([a], { primarySourceKey: null }).document;
    expect(doc.primarySourceKey).toBeNull();
    expect(doc.editingFileName).toBeUndefined();
    expect(doc.sourceTemplate).toBeUndefined();
    expect(doc.preservedImports).toEqual([]);
    expect(doc.referenceFiles).toEqual(["a.cdl"]);
    expect(CdlDocumentLoader.loadSources([a]).document.primarySourceKey).toBe(a.sourcePath);
    expect(CdlDocumentLoader.loadSources([], { primarySourceKey: null }).document.sourceOrder).toEqual([]);
  });

  it("rejects nonexistent and generated primary keys", () => {
    expect(() => CdlDocumentLoader.loadSources([source("a")], { primarySourceKey: "/missing.cdl" })).toThrow();
    expect(() => CdlDocumentLoader.loadSources([{ ...source("a"), generated: true }], {
      primarySourceKey: "/project/a.cdl",
    })).toThrow();
  });

  it("moves source location and its cells and template together for Save As", () => {
    const a = source("a", "cell tX cA {};");
    const b = source("b", "cell tX cB {};");
    const doc = CdlDocumentLoader.loadSources([a, b], { primarySourceKey: a.sourcePath }).document;
    const moved = doc.withSourceLocation(a.sourcePath!, "/new/a.cdl");
    expect(moved.primarySourceKey).toBe("/new/a.cdl");
    expect(moved.editingFileName).toBe("/new/a.cdl");
    expect(moved.sourceOrder).toEqual(["/new/a.cdl", b.sourcePath]);
    expect(moved.getCell(asCellId("cA"))?.locale).toBe("/new/a.cdl");
    expect(moved.getCell(asCellId("cB"))?.locale).toBe(b.sourcePath);
    expect(moved.sourceTemplates.has(a.sourcePath!)).toBe(false);
    expect(moved.sourceTemplates.get("/new/a.cdl")).toBe(doc.sourceTemplate);
    expect(doc.primarySourceKey).toBe(a.sourcePath);
  });
});

class MoveA extends Command {
  readonly kind = "stage0-test-move";
  constructor(private readonly x: number) { super(); }
  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(asCellId("cA"));
    return cell ? doc.withCell(cell.moveTo(this.x, cell.y)) : doc;
  }
}

describe("stage 0 history identity", () => {
  it("keeps node IDs over replay and undo/redo and allocates a fresh ID on branching", () => {
    const root = History.begin(CdlDocumentLoader.loadSingle("cell tX cA {};", "a.cdl").document);
    const first = root.commit(new MoveA(30));
    const second = first.commit(new MoveA(40));
    expect(first.nodeId).not.toBe(root.nodeId);
    expect(second.nodeId).not.toBe(first.nodeId);
    void second.current;
    expect(second.undo().nodeId).toBe(first.nodeId);
    expect(second.undo().redo().nodeId).toBe(second.nodeId);
    expect(second.undo().commit(new MoveA(50)).nodeId).not.toBe(second.nodeId);
  });

  it("does not create a node or discard redo for a no-op even with a new document object", () => {
    const root = History.begin(CdlDocumentLoader.loadSingle("cell tX cA {}; cell tX cB {};", "a.cdl").document);
    const done = root.commit(new MoveA(30));
    const undo = done.undo();
    const noChange = undo.commit(new MoveA(undo.current.getCell(asCellId("cA"))!.x));
    expect(noChange.nodeId).toBe(undo.nodeId);
    expect(noChange.canRedo).toBe(true);
    expect(noChange.past).toEqual(undo.past);
  });
});

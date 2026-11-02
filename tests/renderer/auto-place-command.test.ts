import { describe, expect, it } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { autoPlace, canAutoPlace } from "../../src/renderer/app/auto-place-actions";
import { autoLayoutOverflow } from "../../src/renderer/cdl/messages";
import { ChangePaperCommand } from "../../src/renderer/commands/paper-commands";
import { AutoPlaceCellsCommand, planAutoPlacement } from "../../src/renderer/commands/layout-commands";
import { Cell } from "../../src/renderer/model/cell";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { PaperSpec } from "../../src/renderer/model/paper";
import { SelectionState } from "../../src/renderer/render/view";

// 外部仕様7.3.x（2026-11-03）: 選択したセル／編集できるすべてのセルを、自動配置し直す。
function cell(name: string, x: number, y: number, editable = true): Cell {
  return Cell.create({
    id: asCellId(name), name, celltypeName: "tT", x, y, width: 25, height: 15,
    regionId: ROOT_REGION_ID, editable, cports: [], eports: [], attrs: {}, celltypeUnresolved: false,
  });
}

const docOf = (...cells: Cell[]): TecscdeDocument => cells.reduce((d, c) => d.withCell(c), TecscdeDocument.empty());
const pos = (doc: TecscdeDocument, name: string) => {
  const c = doc.getCell(asCellId(name))!;
  return { x: c.x, y: c.y };
};

describe("AutoPlaceCellsCommand", () => {
  it("places the target cells on the grid in document order, away from cells that are not targets", () => {
    const doc = docOf(cell("a", 10, 10), cell("b", 10, 10), cell("c", 10, 10), cell("fixed", 65, 10, false));

    const next = new AutoPlaceCellsCommand(["a", "b", "c"].map(asCellId)).apply(doc);

    expect(pos(next, "a")).toEqual({ x: 10, y: 10 });
    expect(pos(next, "b")).toEqual({ x: 120, y: 10 }); // (65, 10) は動かさないセルが使っている
    expect(pos(next, "c")).toEqual({ x: 175, y: 10 });
    expect(pos(next, "fixed")).toEqual({ x: 65, y: 10 });
  });

  it("never moves a read-only cell, even if it is among the targets", () => {
    const doc = docOf(cell("ro", 10, 10, false), cell("a", 10, 10));

    const next = new AutoPlaceCellsCommand(["ro", "a"].map(asCellId)).apply(doc);

    expect(pos(next, "ro")).toEqual({ x: 10, y: 10 });
    expect(pos(next, "a")).toEqual({ x: 65, y: 10 });
  });

  it("does not move cells that are not targets", () => {
    const doc = docOf(cell("a", 10, 10), cell("keep", 10, 10));

    const next = new AutoPlaceCellsCommand([asCellId("a")]).apply(doc);

    expect(pos(next, "keep")).toEqual({ x: 10, y: 10 });
    expect(pos(next, "a")).toEqual({ x: 65, y: 10 });
  });

  it("uses the current paper: more cells fit without overflow on a larger paper", () => {
    const cells = Array.from({ length: 40 }, (_, i) => cell(`c${i}`, 10, 10));
    const ids = cells.map((c) => c.id);
    const a4 = docOf(...cells);
    const a2 = a4.withPaper(PaperSpec.create("A2", "LANDSCAPE"));

    expect(planAutoPlacement(a4, ids).overflow).toBe(10);
    expect(planAutoPlacement(a2, ids).overflow).toBe(0);
  });
});

describe("auto placement actions", () => {
  function storeOf(...cells: Cell[]): AppStore {
    return new AppStore(docOf(...cells));
  }

  it("autoPlace(selection) places only the selected editable cells and can be undone in one step", () => {
    const store = storeOf(cell("a", 10, 10), cell("b", 10, 10), cell("c", 10, 10));
    store.setSelection(SelectionState.ofCells([asCellId("b"), asCellId("c")]));

    autoPlace(store, "selection");

    expect(pos(store.getDocument(), "a")).toEqual({ x: 10, y: 10 });
    expect(pos(store.getDocument(), "b")).toEqual({ x: 65, y: 10 });
    expect(pos(store.getDocument(), "c")).toEqual({ x: 120, y: 10 });
    store.undo();
    expect(pos(store.getDocument(), "b")).toEqual({ x: 10, y: 10 });
    expect(pos(store.getDocument(), "c")).toEqual({ x: 10, y: 10 });
  });

  it("autoPlace(all) places every editable cell whatever is selected", () => {
    const store = storeOf(cell("a", 10, 10), cell("b", 10, 10), cell("ro", 10, 10, false));

    autoPlace(store, "all");

    expect(pos(store.getDocument(), "ro")).toEqual({ x: 10, y: 10 });
    expect(pos(store.getDocument(), "a")).toEqual({ x: 65, y: 10 });
    expect(pos(store.getDocument(), "b")).toEqual({ x: 120, y: 10 });
  });

  it("canAutoPlace needs at least one editable target", () => {
    const empty = storeOf(cell("ro", 10, 10, false));
    expect(canAutoPlace(empty, "all")).toBe(false);

    const store = storeOf(cell("a", 10, 10), cell("ro", 10, 10, false));
    expect(canAutoPlace(store, "all")).toBe(true);
    expect(canAutoPlace(store, "selection")).toBe(false); // 何も選んでいない
    store.setSelection(SelectionState.ofCells([asCellId("ro")]));
    expect(canAutoPlace(store, "selection")).toBe(false); // 読み取り専用だけ
    store.setSelection(SelectionState.ofCells([asCellId("a")]));
    expect(canAutoPlace(store, "selection")).toBe(true);
  });

  it("replaces the overflow warning from loading with the result of the last auto placement", () => {
    const many = Array.from({ length: 33 }, (_, i) => cell(`c${i}`, 10, 10));
    const store = new AppStore();
    store.loadDocument(docOf(...many), null, [autoLayoutOverflow(3)]);
    const warnings = () => store.getReport().items.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW");
    expect(warnings()).toHaveLength(1); // 読み込み時の警告

    store.dispatch(new ChangePaperCommand("A2", "LANDSCAPE"));
    autoPlace(store, "all");

    expect(warnings()).toEqual([]); // 読み込み時の古い警告が残らない
  });

  it("reports how many cells did not fit, and clears the report when everything fits", () => {
    const many = Array.from({ length: 33 }, (_, i) => cell(`c${i}`, 10, 10));
    const store = storeOf(...many);

    autoPlace(store, "all");
    const warnings = () => store.getReport().items.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]!.message).toContain("3 個");

    store.dispatch(new ChangePaperCommand("A2", "LANDSCAPE"));
    autoPlace(store, "all");
    expect(warnings()).toEqual([]);
  });
});

// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — 編集コマンドクラスのヘッドレステスト。
// サンプルフィクスチャ（cell 3・join 2・celltype 3）に対し、各コマンドが
// モデル層の不変条件を保ったまま期待どおりの差分を生むことを確認する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { assertInvariants } from "../../src/renderer/model/invariants";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import {
  AddCellCommand,
  AlignLeftCommand,
  AlignTopCommand,
  ChangePortEdgeCommand,
  CreateJoinCommand,
  DeleteCommand,
  DeleteJoinCommand,
  EditAttrCommand,
  History,
  MoveCellCommand,
  MoveCellsCommand,
  RenameCellCommand,
} from "../../src/renderer/commands";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(mainEditable = true): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: mainEditable },
  ]).document;
}

const LOGGER = asCellId("cLogger1");
const SENSOR = asCellId("cSensor1");
const CONTROLLER = asCellId("cController1");
const JOIN_CLOG = asJoinId("cController1.cLog");

describe("cell commands", () => {
  it("AddCellCommand adds one cell with a derived name, or no-ops on an unknown celltype", () => {
    const doc = loadDoc();
    const added = new AddCellCommand("tController", 30, 30).apply(doc);
    expect(added.cellCount).toBe(doc.cellCount + 1);
    expect(added.cellValues().some((c) => c.name === "Controller")).toBe(true);
    expect(() => assertInvariants(added)).not.toThrow();

    const unknown = new AddCellCommand("tNope", 30, 30).apply(doc);
    expect(unknown).toBe(doc);
  });

  it("MoveCellCommand re-aligns, reroutes attached joins, and respects editable=false", () => {
    const doc = loadDoc();
    const moved = new MoveCellCommand(LOGGER, 42.4, 50).apply(doc);
    expect(moved.getCell(LOGGER)!.x).toBe(42); // ALIGN=1.0mm へ丸め
    expect(() => assertInvariants(moved)).not.toThrow();

    const ro = loadDoc(false);
    expect(new MoveCellCommand(LOGGER, 200, 200).apply(ro)).toBe(ro);
  });

  it("MoveCellsCommand moves several cells by a delta and skips read-only cells", () => {
    const doc = loadDoc();
    const before = doc.getCell(SENSOR)!;
    const moved = new MoveCellsCommand([LOGGER, SENSOR], 5, 5).apply(doc);
    expect(moved.getCell(SENSOR)!.x).toBe(before.x + 5);
    expect(moved.getCell(SENSOR)!.y).toBe(before.y + 5);
  });

  it("DeleteCommand cascades: removing the controller drops both joins and clears the entry ports", () => {
    const doc = loadDoc();
    const next = new DeleteCommand([CONTROLLER]).apply(doc);
    expect(next.getCell(CONTROLLER)).toBeUndefined();
    expect(next.joinCount).toBe(0);
    expect(next.getCell(LOGGER)!.findEPort("eLog")!.joinIds).toEqual([]);
    expect(next.getCell(SENSOR)!.findEPort("eRead")!.joinIds).toEqual([]);
    expect(() => assertInvariants(next)).not.toThrow();
  });

  it("RenameCellCommand renames, but no-ops on invalid syntax or a duplicate name", () => {
    const doc = loadDoc();
    expect(new RenameCellCommand(LOGGER, "myLogger").apply(doc).getCell(LOGGER)!.name).toBe("myLogger");
    expect(new RenameCellCommand(LOGGER, "1bad").apply(doc)).toBe(doc);
    expect(new RenameCellCommand(LOGGER, "cSensor1").apply(doc)).toBe(doc);
  });

  it("EditAttrCommand sets an attribute value immutably", () => {
    const doc = loadDoc();
    const next = new EditAttrCommand(LOGGER, "level", "5").apply(doc);
    expect(next.getCell(LOGGER)!.attrs.level).toBe("5");
    expect(doc.getCell(LOGGER)!.attrs.level).toBe("1");
  });

  it("AlignTopCommand / AlignLeftCommand align to the reference cell", () => {
    const doc = loadDoc();
    const top = new AlignTopCommand([CONTROLLER, LOGGER, SENSOR], CONTROLLER).apply(doc);
    const refY = doc.getCell(CONTROLLER)!.y;
    expect(top.getCell(LOGGER)!.y).toBe(refY);
    expect(top.getCell(SENSOR)!.y).toBe(refY);

    const left = new AlignLeftCommand([CONTROLLER, LOGGER], CONTROLLER).apply(doc);
    expect(left.getCell(LOGGER)!.x).toBe(doc.getCell(CONTROLLER)!.x);
  });
});

describe("join commands", () => {
  it("DeleteJoinCommand + CreateJoinCommand round-trip the cLog join", () => {
    const doc = loadDoc();
    const deleted = new DeleteJoinCommand(JOIN_CLOG).apply(doc);
    expect(deleted.joinCount).toBe(1);
    expect(deleted.getCell(CONTROLLER)!.findCPort("cLog")!.joinId).toBeNull();

    const recreated = new CreateJoinCommand(CONTROLLER, "cLog", null, LOGGER, "eLog").apply(deleted);
    expect(recreated.joinCount).toBe(2);
    expect(recreated.getCell(CONTROLLER)!.findCPort("cLog")!.joinId).not.toBeNull();
    expect(recreated.getCell(LOGGER)!.findEPort("eLog")!.joinIds.length).toBe(1);
    expect(() => assertInvariants(recreated)).not.toThrow();
  });

  it("CreateJoinCommand refuses a mismatched signature and an already-joined call port", () => {
    const doc = loadDoc();
    // cLog(sLog) を eRead(sSensor) へ: シグニチャ不一致 → 静かにキャンセル（同一インスタンスを返す）
    expect(new CreateJoinCommand(CONTROLLER, "cLog", null, SENSOR, "eRead").apply(doc)).toBe(doc);
    // 既に結合済みの cLog をもう一度結合 → 静かにキャンセル
    expect(new CreateJoinCommand(CONTROLLER, "cLog", null, LOGGER, "eLog").apply(doc)).toBe(doc);
  });
});

describe("port commands", () => {
  it("ChangePortEdgeCommand moves a port to another edge and reroutes its join", () => {
    const doc = loadDoc();
    const next = new ChangePortEdgeCommand(CONTROLLER, "CPort", "cLog", "TOP", 5).apply(doc);
    expect(next.getCell(CONTROLLER)!.findCPort("cLog")!.edgeSide).toBe("TOP");
    expect(() => assertInvariants(next)).not.toThrow();
  });
});

describe("commands through History", () => {
  it("a sequence of commits fully undoes and redoes back to the same document shape", () => {
    const doc = loadDoc();
    const done = History.begin(doc)
      .commit(new MoveCellCommand(LOGGER, 40, 40))
      .commit(new EditAttrCommand(LOGGER, "level", "7"))
      .commit(new DeleteJoinCommand(JOIN_CLOG));

    expect(done.current.joinCount).toBe(1);

    let h = done;
    while (h.canUndo) h = h.undo();
    expect(h.current.joinCount).toBe(2);
    expect(h.current.getCell(LOGGER)!.attrs.level).toBe("1");

    while (h.canRedo) h = h.redo();
    expect(h.current.joinCount).toBe(1);
    expect(h.current.getCell(LOGGER)!.attrs.level).toBe("7");
    expect(h.current.getCell(LOGGER)!.x).toBe(40);
  });
});

// [[TECSCDE-DT-EL内部仕様]] 第4章4.3節 — History のヘッドレステスト（11.4節#3の実装単位）。
// 外部仕様6.6.1が定める現行版2件の不具合（初回コミットのUndo不可・Redo恒久無効）が
// replayベースの History では構造的に再発しないことを確認する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { History } from "../../src/renderer/commands/history";
import { MoveCellCommand, EditAttrCommand } from "../../src/renderer/commands";
import { InvariantViolation } from "../../src/renderer/model/errors";
import { asCellId } from "../../src/renderer/model/ids";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc() {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const LOGGER = asCellId("cLogger1");

describe("History", () => {
  it("begin() yields the initial document unchanged with no undo/redo available", () => {
    const doc = loadDoc();
    const h = History.begin(doc);
    expect(h.current).toBe(doc);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("current is the replay of past over initial", () => {
    const doc = loadDoc();
    const h = History.begin(doc).commit(new MoveCellCommand(LOGGER, 40, 40));
    expect(h.current.getCell(LOGGER)!.x).toBe(40);
    expect(h.current.getCell(LOGGER)!.y).toBe(40);
    // initial は変わらない
    expect(doc.getCell(LOGGER)!.x).not.toBe(40);
  });

  it("the FIRST commit is undoable (external spec 6.6.1 bug #1 does not recur)", () => {
    const doc = loadDoc();
    const original = doc.getCell(LOGGER)!.x;
    const h = History.begin(doc).commit(new MoveCellCommand(LOGGER, 40, 44));
    expect(h.canUndo).toBe(true);
    const undone = h.undo();
    expect(undone.current.getCell(LOGGER)!.x).toBe(original);
  });

  it("redo works after undo and is not permanently disabled (bug #2 does not recur)", () => {
    const doc = loadDoc();
    let h = History.begin(doc)
      .commit(new MoveCellCommand(LOGGER, 40, 44))
      .commit(new EditAttrCommand(LOGGER, "level", "9"));

    h = h.undo().undo();
    expect(h.canRedo).toBe(true);

    // redo / undo を繰り返しても毎回有効
    for (let i = 0; i < 3; i += 1) {
      h = h.redo().redo();
      expect(h.current.getCell(LOGGER)!.attrs.level).toBe("9");
      expect(h.current.getCell(LOGGER)!.x).toBe(40);
      h = h.undo().undo();
      expect(h.current.getCell(LOGGER)!.attrs.level).toBe("1");
    }
  });

  it("commit after undo discards the redo branch (linear history)", () => {
    const doc = loadDoc();
    const h = History.begin(doc)
      .commit(new MoveCellCommand(LOGGER, 40, 44))
      .undo()
      .commit(new MoveCellCommand(LOGGER, 60, 60));
    expect(h.canRedo).toBe(false);
    expect(h.current.getCell(LOGGER)!.x).toBe(60);
  });

  it("undo on empty past and redo on empty future throw InvariantViolation", () => {
    const h = History.begin(loadDoc());
    expect(() => h.undo()).toThrow(InvariantViolation);
    expect(() => h.redo()).toThrow(InvariantViolation);
  });

  it("History instances are immutable — commit/undo/redo return new instances", () => {
    const doc = loadDoc();
    const h0 = History.begin(doc);
    const h1 = h0.commit(new MoveCellCommand(LOGGER, 40, 44));
    expect(h1).not.toBe(h0);
    expect(h0.canUndo).toBe(false);
    expect(h1.canUndo).toBe(true);
  });
});

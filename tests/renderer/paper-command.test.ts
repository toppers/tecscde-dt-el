// 外部仕様3.2.1: 用紙変更を保存・Undo/Redoできること。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { AppStore } from "../../src/renderer/app/store";
import { ChangePaperCommand } from "../../src/renderer/commands";

const celltypes = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const main = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc() {
  return CdlDocumentLoader.loadSources([
    { text: celltypes, fileName: "celltypes.cdl", editable: true },
    { text: main, fileName: "main.cde", editable: true },
  ]).document;
}

describe("ChangePaperCommand", () => {
  it("changes the paper while preserving diagram elements and replaying through Undo/Redo", () => {
    const original = loadDoc();
    const store = new AppStore(original);
    store.dispatch(new ChangePaperCommand("A3", "PORTRAIT"));

    expect(store.getDocument().paper.size).toBe("A3");
    expect(store.getDocument().paper.orientation).toBe("PORTRAIT");
    expect(store.getDocument().paper.contentSize()).toEqual({ width: 277, height: 400 });
    expect(store.getDocument().cellValues()).toEqual(original.cellValues());
    expect(store.getDocument().joinValues()).toEqual(original.joinValues());
    expect(store.isDirty()).toBe(true);
    store.undo();
    expect(store.getDocument().paper).toBe(original.paper);
    expect(store.isDirty()).toBe(false);
    store.redo();
    expect(store.getDocument().paper.contentSize()).toEqual({ width: 277, height: 400 });
  });

  it("round-trips size and orientation through CDL and ignores an unchanged setting", () => {
    const doc = loadDoc();
    expect(new ChangePaperCommand(doc.paper.size, doc.paper.orientation).apply(doc)).toBe(doc);
    const changed = new ChangePaperCommand("A2", "LANDSCAPE").apply(doc);
    const saved = CdlSerializer.serialize(changed);
    const reloaded = CdlDocumentLoader.loadSources([
      { text: saved, fileName: "saved.cde", editable: true },
    ]).document;
    expect(reloaded.paper.size).toBe("A2");
    expect(reloaded.paper.orientation).toBe("LANDSCAPE");
  });
});

// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— `AppStore` のヘッドレステスト。
// dispatch→undo→redo のドキュメント一致、DirtyTracker（7.3節）の遷移、購読通知。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId } from "../../src/renderer/model/ids";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { AppStore } from "../../src/renderer/app/store";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const CONTROLLER = asCellId("cController1");

function xOf(doc: TecscdeDocument): number {
  return doc.getCell(CONTROLLER)!.x;
}

describe("AppStore — dispatch / undo / redo", () => {
  it("dispatch applies, undo reverts, redo re-applies (byte-identical positions)", () => {
    const store = new AppStore(loadDoc());
    const x0 = xOf(store.getDocument());

    store.dispatch(new MoveCellsCommand([CONTROLLER], 5, 0));
    expect(xOf(store.getDocument())).toBe(x0 + 5);
    expect(store.canUndo).toBe(true);

    store.undo();
    expect(xOf(store.getDocument())).toBe(x0);
    expect(store.canRedo).toBe(true);

    store.redo();
    expect(xOf(store.getDocument())).toBe(x0 + 5);
  });

  it("undo works from the very first commit (no off-by-one, 外部仕様6.6.2)", () => {
    const store = new AppStore(loadDoc());
    expect(store.canUndo).toBe(false);
    store.dispatch(new MoveCellsCommand([CONTROLLER], 1, 1));
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.canUndo).toBe(false);
  });
});

describe("AppStore — DirtyTracker", () => {
  it("clean → dirty on edit → clean on markSaved → dirty again on next edit", () => {
    const store = new AppStore(loadDoc());
    expect(store.isDirty()).toBe(false);

    store.dispatch(new MoveCellsCommand([CONTROLLER], 3, 0));
    expect(store.isDirty()).toBe(true);

    store.markSaved("C:/tmp/main.cde");
    expect(store.isDirty()).toBe(false);
    expect(store.filePath).toBe("C:/tmp/main.cde");

    store.dispatch(new MoveCellsCommand([CONTROLLER], 3, 0));
    expect(store.isDirty()).toBe(true);
  });

  it("undo back to the saved point clears dirty", () => {
    const store = new AppStore(loadDoc());
    store.dispatch(new MoveCellsCommand([CONTROLLER], 3, 0));
    store.markSaved("x.cde");
    store.dispatch(new MoveCellsCommand([CONTROLLER], 3, 0));
    expect(store.isDirty()).toBe(true);
    store.undo();
    expect(store.isDirty()).toBe(false);
  });
});

describe("AppStore — subscription & loadDocument", () => {
  it("notifies subscribers on every mutation and stops after unsubscribe", () => {
    const store = new AppStore(loadDoc());
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls += 1;
    });

    store.dispatch(new MoveCellsCommand([CONTROLLER], 1, 0));
    store.setMode("newCell");
    expect(calls).toBe(2);

    unsub();
    store.setMode("select");
    expect(calls).toBe(2);
  });

  it("loadDocument resets history, selection and dirty marker", () => {
    const store = new AppStore(loadDoc());
    store.dispatch(new MoveCellsCommand([CONTROLLER], 9, 9));
    expect(store.canUndo).toBe(true);

    store.loadDocument(loadDoc(), "fresh.cde");
    expect(store.canUndo).toBe(false);
    expect(store.isDirty()).toBe(false);
    expect(store.filePath).toBe("fresh.cde");
  });
});

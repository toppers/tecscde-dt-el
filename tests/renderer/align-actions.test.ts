// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — 整列操作のアプリ層（外部仕様7.3.2）。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { alignSelection, canAlign } from "../../src/renderer/app/align-actions";
import { MoveCellsCommand } from "../../src/renderer/commands";
import { assertInvariants } from "../../src/renderer/model/invariants";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(mainEditable = true): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: mainEditable },
  ]).document;
}

// フィクスチャ: cLogger1 (10,10)、cSensor1 (65,10)、cController1 (120,10)。
const LOGGER = asCellId("cLogger1");
const SENSOR = asCellId("cSensor1");
const CONTROLLER = asCellId("cController1");

/** 選択順を保ったままセルを選択する（Shift+クリックの積み重ねに相当）。 */
function select(store: AppStore, ...ids: ReturnType<typeof asCellId>[]): void {
  let sel = SelectionState.empty();
  for (const id of ids) sel = sel.withCellAdded(id);
  store.setSelection(sel);
}

const pos = (store: AppStore, id: ReturnType<typeof asCellId>) => {
  const c = store.getDocument().getCell(id)!;
  return { x: c.x, y: c.y };
};

describe("整列操作 — 外部仕様7.3.2", () => {
  it("is unavailable with fewer than two selected cells", () => {
    const store = new AppStore(loadDoc());
    expect(canAlign(store, "left")).toBe(false);
    select(store, LOGGER);
    expect(canAlign(store, "left")).toBe(false);
    expect(canAlign(store, "top")).toBe(false);
  });

  it("aligns left edges to the FIRST selected cell, not the first in model order", () => {
    const store = new AppStore(loadDoc());
    select(store, SENSOR, LOGGER); // 最初に選んだのは cSensor1 (x=65)
    expect(canAlign(store, "left")).toBe(true);
    alignSelection(store, "left");
    expect(pos(store, LOGGER).x).toBe(65);
    expect(pos(store, SENSOR).x).toBe(65);
    expect(pos(store, LOGGER).y).toBe(10); // y は触らない
    assertInvariants(store.getDocument());
  });

  it("aligns top edges to the first selected cell and is undoable", () => {
    const store = new AppStore(loadDoc());
    store.dispatch(new MoveCellsCommand([SENSOR], 0, 5)); // cSensor1 を y=15 にずらす
    select(store, LOGGER, SENSOR);
    expect(canAlign(store, "top")).toBe(true);
    alignSelection(store, "top");
    expect(pos(store, SENSOR).y).toBe(10);
    store.undo();
    expect(pos(store, SENSOR).y).toBe(15);
  });

  it("does nothing, and adds no history entry, when the cells are already aligned", () => {
    const store = new AppStore(loadDoc());
    select(store, LOGGER, SENSOR, CONTROLLER); // 3つとも y=10
    expect(canAlign(store, "top")).toBe(false);
    const before = store.history;
    alignSelection(store, "top");
    expect(store.history).toBe(before);
  });

  it("does not move read-only cells", () => {
    const store = new AppStore(loadDoc(false));
    select(store, LOGGER, SENSOR);
    expect(canAlign(store, "left")).toBe(false);
  });
});

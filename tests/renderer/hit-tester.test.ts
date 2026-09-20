// [[TECSCDE-DT-EL内部仕様]] 第5章5.2節 — `HitTester` のヘッドレステスト。
// サンプルフィクスチャ（cell 3・join 2）に対し、優先順位（ポート＞セル＞結合バー）と
// 「結合バー探索を一定ピクセル半径内に限定する」改善（外部仕様6.2.2）を検証する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { HitTester } from "../../src/renderer/render/hit-tester";
import { defaultCanvasView } from "../../src/renderer/render/view";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

// フィクスチャの実座標（自動配置の結果、_explore で確認済み）:
//   cLogger1    (10,10) 25x15   eport eLog @ (35,18)
//   cSensor1    (65,10) 25x15   eport eRead @ (90,18)
//   cController1 (120,10) 25x15 cport cLog @ (120,15) / cSensor @ (120,20)
//   join cController1.cLog:  水平バー y=15 が x≈39..116 を走る
const LOGGER = asCellId("cLogger1");
const CONTROLLER = asCellId("cController1");
const JOIN_CLOG = asJoinId("cController1.cLog");

function tester(doc: TecscdeDocument): HitTester {
  return new HitTester(doc, defaultCanvasView());
}

describe("HitTester.hitTest — priority ポート＞セル＞結合バー", () => {
  it("returns the call port when the point is on a cport (even though it is also on the cell edge)", () => {
    const hit = tester(loadDoc()).hitTest({ x: 120, y: 15 });
    expect(hit).toEqual({ kind: "cport", cellId: CONTROLLER, portName: "cLog", subscript: null });
  });

  it("returns the entry port when the point is on an eport", () => {
    const hit = tester(loadDoc()).hitTest({ x: 35, y: 18 });
    expect(hit).toEqual({ kind: "eport", cellId: LOGGER, portName: "eLog", subscript: null });
  });

  it("returns the cell body when the point is inside a cell but away from ports", () => {
    const hit = tester(loadDoc()).hitTest({ x: 130, y: 15 });
    expect(hit).toEqual({ kind: "cell", cellId: CONTROLLER });
  });

  it("returns the join bar when the point is on a bar segment outside every cell", () => {
    const hit = tester(loadDoc()).hitTest({ x: 50, y: 15 });
    expect(hit.kind).toBe("joinBar");
    if (hit.kind === "joinBar") {
      expect(hit.joinId).toBe(JOIN_CLOG);
      expect(hit.barIndex).toBe(1); // 長い水平区間
    }
  });

  it("returns none for empty space", () => {
    expect(tester(loadDoc()).hitTest({ x: 300, y: 300 })).toEqual({ kind: "none" });
  });

  it("6.2.2: a point several mm from any bar is empty space, not a bar hit (radius-limited search)", () => {
    // (50,25): どのセルにも含まれず、最寄りの結合バー(y=15 / y=20)からも 5mm 以上離れている。
    // 現行版の「モデル全体探索」なら拾ってしまうが、半径限定により none になる。
    expect(tester(loadDoc()).hitTest({ x: 50, y: 25 })).toEqual({ kind: "none" });
  });
});

describe("HitTester.hitTestRect — ラバーバンド選択（外部仕様6.8.2）", () => {
  it("returns every cell fully inside the rectangle", () => {
    const ids = tester(loadDoc()).hitTestRect({ x: 0, y: 0 }, { x: 200, y: 200 });
    expect(new Set(ids)).toEqual(new Set([asCellId("cLogger1"), asCellId("cSensor1"), CONTROLLER]));
  });

  it("excludes cells only partially covered", () => {
    const ids = tester(loadDoc()).hitTestRect({ x: 0, y: 0 }, { x: 40, y: 40 });
    expect(ids).toEqual([asCellId("cLogger1")]);
  });
});

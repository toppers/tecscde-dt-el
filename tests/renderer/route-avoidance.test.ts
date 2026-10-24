// 外部仕様7.3.2 — 結合の経路を生成・再計算するとき、他のセルの矩形と重ならない経路を優先する（文書レベル）。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { rerouteJoin } from "../../src/renderer/commands/support";
import { CreateJoinCommand, DeleteJoinCommand, MoveCellsCommand } from "../../src/renderer/commands";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import type { Bar } from "../../src/renderer/model/join";
import type { Cell } from "../../src/renderer/model/cell";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

// フィクスチャ: cLogger1 (10,10)、cSensor1 (65,10)、cController1 (120,10)（いずれも 25x15）。
// 結合 cController1.cLog → cLogger1.eLog は、保存済みの経路が y=15 の水平線で、cSensor1 を貫いている。
const SENSOR = asCellId("cSensor1");
const CLOG = asJoinId("cController1.cLog");

function crosses(bars: readonly Bar[], rect: Cell): boolean {
  return bars.slice(1, -1).some((b) => {
    const lo = Math.min(b.from, b.to);
    const hi = Math.max(b.from, b.to);
    return b.direction === "H"
      ? b.fixed > rect.y && b.fixed < rect.y + rect.height && hi > rect.x && lo < rect.x + rect.width
      : b.fixed > rect.x && b.fixed < rect.x + rect.width && hi > rect.y && lo < rect.y + rect.height;
  });
}

describe("結合の経路は他のセルを避ける（外部仕様7.3.2）", () => {
  it("loading a join without a stored route avoids cSensor1 (the old route ran straight through it)", () => {
    const doc = loadDoc();
    expect(crosses(doc.getJoin(CLOG)!.bars, doc.getCell(SENSOR)!)).toBe(false);
  });

  it("CreateJoinCommand routes around cSensor1", () => {
    const freed = new DeleteJoinCommand(CLOG).apply(loadDoc());
    const joined = new CreateJoinCommand(asCellId("cController1"), "cLog", null, asCellId("cLogger1"), "eLog").apply(freed);
    const join = [...joined.joinValues()].find((j) => j.cportName === "cLog")!;
    expect(crosses(join.bars, joined.getCell(SENSOR)!)).toBe(false);
  });

  it("moving a cell reroutes its joins around the other cells", () => {
    const moved = new MoveCellsCommand([asCellId("cController1")], 0, 1).apply(loadDoc());
    expect(crosses(moved.getJoin(CLOG)!.bars, moved.getCell(SENSOR)!)).toBe(false);
  });

  it("rerouteJoin recomputes around a cell that was moved into the way", () => {
    // cSensor1 を cLogger1 と cController1 のあいだの、現在の経路の真上へ動かす（結合をもたない側だけを動かす）。
    const doc = loadDoc();
    const bar = doc.getJoin(CLOG)!.bars.slice(1, -1).reduce((a, b) => (Math.abs(b.to - b.from) > Math.abs(a.to - a.from) ? b : a));
    const mid = (bar.from + bar.to) / 2;
    const sensor = doc.getCell(SENSOR)!;
    const blocker =
      bar.direction === "H"
        ? sensor.moveTo(mid - sensor.width / 2, bar.fixed - sensor.height / 2)
        : sensor.moveTo(bar.fixed - sensor.width / 2, mid - sensor.height / 2);
    const blocked = doc.withCell(blocker);
    expect(crosses(blocked.getJoin(CLOG)!.bars, blocker)).toBe(true); // 前提: 古い経路は新しい位置を貫く
    const next = rerouteJoin(blocked, CLOG);
    expect(crosses(next.getJoin(CLOG)!.bars, next.getCell(SENSOR)!)).toBe(false);
  });
});

// 重なったセルでは、描画で一番上に見えるセルを選ぶ。
// 描画（SvgRenderer）は doc.cellValues() の順に重ねるので、並びの後ろのセルが上に見える。
// ヒットテストが先頭から探すと、見えていない下のセルが選ばれ、プロパティの表示が図と食い違う。
import { describe, expect, it } from "vitest";
import { Cell } from "../../src/renderer/model/cell";
import { CPort, EPort } from "../../src/renderer/model/port";
import { asCellId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { HitTester } from "../../src/renderer/render/hit-tester";
import { defaultCanvasView } from "../../src/renderer/render/view";

function cell(name: string, x: number, y: number, withPorts: boolean): Cell {
  return Cell.create({
    id: asCellId(name),
    name,
    celltypeName: "tT",
    x,
    y,
    width: 25,
    height: 15,
    regionId: ROOT_REGION_ID,
    editable: true,
    cports: withPorts
      ? [CPort.create({ name: "c", signature: "sX", edgeSide: "LEFT", offset: 5, subscript: null, arraySize: null })]
      : [],
    eports: withPorts
      ? [EPort.create({ name: "e", signature: "sX", edgeSide: "RIGHT", offset: 5, subscript: null, arraySize: null })]
      : [],
    attrs: {},
    celltypeUnresolved: false,
  });
}

/** under → over の順に追加する（cellValues() の並びの後ろ = 描画で上）。 */
function docWith(...cells: Cell[]): TecscdeDocument {
  return cells.reduce((doc, c) => doc.withCell(c), TecscdeDocument.empty());
}

const tester = (doc: TecscdeDocument) => new HitTester(doc, defaultCanvasView());

describe("HitTester on overlapping cells selects the one drawn on top", () => {
  it("returns the later cell for a point inside two stacked cells", () => {
    const doc = docWith(cell("under", 10, 10, false), cell("over", 10, 10, false));

    expect(tester(doc).hitTest({ x: 20, y: 17 })).toEqual({ kind: "cell", cellId: asCellId("over") });
  });

  it("returns the later cell when only part of the cells overlap", () => {
    const doc = docWith(cell("under", 10, 10, false), cell("over", 25, 10, false));

    expect(tester(doc).hitTest({ x: 30, y: 17 })).toEqual({ kind: "cell", cellId: asCellId("over") }); // 重なり部分
    expect(tester(doc).hitTest({ x: 12, y: 17 })).toEqual({ kind: "cell", cellId: asCellId("under") }); // 下だけの部分
  });

  it("returns the port of the later cell when two ports are at the same place", () => {
    const doc = docWith(cell("under", 10, 10, true), cell("over", 10, 10, true));

    // 呼び口 c は左辺 (10, 15)
    expect(tester(doc).hitTest({ x: 10, y: 15 })).toEqual({
      kind: "cport", cellId: asCellId("over"), portName: "c", subscript: null,
    });
    // 受け口 e は右辺 (35, 15)
    expect(tester(doc).hitTest({ x: 35, y: 15 })).toEqual({
      kind: "eport", cellId: asCellId("over"), portName: "e", subscript: null,
    });
  });
});

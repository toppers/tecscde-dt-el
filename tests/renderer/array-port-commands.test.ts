import { describe, expect, it } from "vitest";
import { Cell } from "../../src/renderer/model/cell";
import { CPort, EPort } from "../../src/renderer/model/port";
import { asCellId, asJoinId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { Join } from "../../src/renderer/model/join";
import { History } from "../../src/renderer/commands/history";
import { DeleteCommand } from "../../src/renderer/commands/cell-commands";
import {
  InsertPortElementCommand,
  DeletePortElementCommand,
} from "../../src/renderer/commands/port-commands";
import type { SelectedPort } from "../../src/renderer/render/view";

function createTestDoc(): TecscdeDocument {
  const cellId = asCellId("cCell1");
  const targetCellId = asCellId("cTarget1");

  // 可変長配列呼び口 cArrayPort[0], cArrayPort[1]
  const cport0 = CPort.create({
    name: "cArrayPort",
    signature: "sSig",
    edgeSide: "RIGHT",
    offset: 5,
    subscript: 0,
    arraySize: null,
  });
  const cport1 = CPort.create({
    name: "cArrayPort",
    signature: "sSig",
    edgeSide: "RIGHT",
    offset: 10,
    subscript: 1,
    arraySize: null,
  });
  // 固定長配列受け口 eFixedPort[0], eFixedPort[1] (arraySize: 2)
  const eFixed0 = EPort.create({
    name: "eFixedPort",
    signature: "sSig",
    edgeSide: "LEFT",
    offset: 5,
    subscript: 0,
    arraySize: 2,
  });
  const eFixed1 = EPort.create({
    name: "eFixedPort",
    signature: "sSig",
    edgeSide: "LEFT",
    offset: 10,
    subscript: 1,
    arraySize: 2,
  });
  // 単一（非配列）呼び口 cSinglePort
  const cSingle = CPort.create({
    name: "cSinglePort",
    signature: "sSig",
    edgeSide: "RIGHT",
    offset: 15,
    subscript: null,
    arraySize: null,
  });

  // ターゲットセルの受け口
  const eTarget0 = EPort.create({
    name: "eTargetPort",
    signature: "sSig",
    edgeSide: "LEFT",
    offset: 5,
    subscript: null,
    arraySize: null,
  });

  const joinId = asJoinId("cCell1.cArrayPort[1]");
  const join = Join.create(
    joinId,
    cellId,
    cport1,
    targetCellId,
    eTarget0,
    [{ direction: "H", fixed: 10, from: 25, to: 50 }],
  );

  const cell = Cell.create({
    id: cellId,
    name: "cCell1",
    celltypeName: "tCell",
    x: 0,
    y: 0,
    width: 25,
    height: 25,
    regionId: ROOT_REGION_ID,
    editable: true,
    cports: [cport0, cport1.withJoin(joinId), cSingle],
    eports: [eFixed0, eFixed1],
    attrs: {},
    celltypeUnresolved: false,
  });

  const targetCell = Cell.create({
    id: targetCellId,
    name: "cTarget1",
    celltypeName: "tTarget",
    x: 50,
    y: 0,
    width: 25,
    height: 25,
    regionId: ROOT_REGION_ID,
    editable: true,
    cports: [],
    eports: [eTarget0.withJoin(joinId)],
    attrs: {},
    celltypeUnresolved: false,
  });

  return TecscdeDocument.empty().withCell(cell).withCell(targetCell).withJoin(join);
}

describe("array port commands (#9)", () => {
  it("InsertPortElementCommand inserts after selected element by default", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    // cArrayPort[0] の後ろに挿入 (Insert) -> cArrayPort[1] が新設され、元の [1] は [2] にシフト
    const cmd = new InsertPortElementCommand(cellId, "CPort", "cArrayPort", 0, false);
    const next = cmd.apply(doc);

    const cell = next.getCell(cellId)!;
    const arrayPorts = cell.cports.filter((p) => p.name === "cArrayPort");
    expect(arrayPorts).toHaveLength(3);
    expect(arrayPorts.map((p) => p.subscript)).toEqual([0, 1, 2]);

    // 元の [1] にあった joinId が新しい [2] に引き継がれていること
    const shiftedPort = arrayPorts.find((p) => p.subscript === 2)!;
    expect(shiftedPort.joinId).toBe(asJoinId("cCell1.cArrayPort[1]"));
  });

  it("InsertPortElementCommand inserts before selected element when before=true (Shift+Insert)", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    // cArrayPort[1] の前に挿入 (Shift+Insert) -> 元の [1] が [2] にシフトされ、[1] が新設
    const cmd = new InsertPortElementCommand(cellId, "CPort", "cArrayPort", 1, true);
    const next = cmd.apply(doc);

    const cell = next.getCell(cellId)!;
    const arrayPorts = cell.cports.filter((p) => p.name === "cArrayPort");
    expect(arrayPorts).toHaveLength(3);
    expect(arrayPorts.map((p) => p.subscript)).toEqual([0, 1, 2]);

    // 元の [1] にあった joinId が [2] にシフトしていること
    const shiftedPort = arrayPorts.find((p) => p.subscript === 2)!;
    expect(shiftedPort.joinId).toBe(asJoinId("cCell1.cArrayPort[1]"));
    // 新設の [1] は未結合
    const newPort = arrayPorts.find((p) => p.subscript === 1)!;
    expect(newPort.joinId).toBeNull();
  });

  it("InsertPortElementCommand rejects fixed array ports and non-array ports", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    // 固定長配列
    const fixedCmd = new InsertPortElementCommand(cellId, "EPort", "eFixedPort", 0, false);
    expect(fixedCmd.apply(doc)).toBe(doc);

    // 非配列ポート
    const singleCmd = new InsertPortElementCommand(cellId, "CPort", "cSinglePort", 0, false);
    expect(singleCmd.apply(doc)).toBe(doc);
  });

  it("DeletePortElementCommand deletes an array element with subscript > 0 and cascades connected join", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    // cArrayPort[1] を削除
    const cmd = new DeletePortElementCommand(cellId, "CPort", "cArrayPort", 1);
    const next = cmd.apply(doc);

    const cell = next.getCell(cellId)!;
    const arrayPorts = cell.cports.filter((p) => p.name === "cArrayPort");
    expect(arrayPorts).toHaveLength(1);
    expect(arrayPorts[0]!.subscript).toBe(0);

    // 接続されていた結合も切断・削除されていること
    expect(next.getJoin(asJoinId("cCell1.cArrayPort[1]"))).toBeUndefined();
    expect(next.joinCount).toBe(0);
  });

  it("DeletePortElementCommand refuses to delete subscript 0 or fixed array", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    // 添字0は削除不可
    const sub0Cmd = new DeletePortElementCommand(cellId, "CPort", "cArrayPort", 0);
    expect(sub0Cmd.apply(doc)).toBe(doc);

    // 固定長配列は削除不可
    const fixedCmd = new DeletePortElementCommand(cellId, "EPort", "eFixedPort", 1);
    expect(fixedCmd.apply(doc)).toBe(doc);
  });

  it("DeleteCommand removes array port elements passed via ports and supports Undo/Redo", () => {
    const doc = createTestDoc();
    const cellId = asCellId("cCell1");

    let history = History.begin(doc);
    const portToDelete: SelectedPort = {
      kind: "cport",
      cellId,
      portName: "cArrayPort",
      subscript: 1,
    };

    history = history.commit(new DeleteCommand([], [], [portToDelete]));
    expect(history.current.getCell(cellId)!.cports.filter((p) => p.name === "cArrayPort")).toHaveLength(1);
    expect(history.current.joinCount).toBe(0);

    // Undo
    history = history.undo();
    expect(history.current.getCell(cellId)!.cports.filter((p) => p.name === "cArrayPort")).toHaveLength(2);
    expect(history.current.joinCount).toBe(1);

    // Redo
    history = history.redo();
    expect(history.current.getCell(cellId)!.cports.filter((p) => p.name === "cArrayPort")).toHaveLength(1);
    expect(history.current.joinCount).toBe(0);
  });
});

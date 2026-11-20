import { describe, expect, it } from "vitest";
import { Cell } from "../../src/renderer/model/cell";
import { CPort, EPort } from "../../src/renderer/model/port";
import { asCellId, asJoinId, asPortId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { Join } from "../../src/renderer/model/join";
import { History } from "../../src/renderer/commands/history";
import {
  DeleteArrayPortElementsCommand,
  InsertArrayPortElementCommand,
  prepareArrayPortElementDeletion,
  prepareArrayPortInsertion,
} from "../../src/renderer/commands/port-commands";
import { GestureController, type GestureHost, type GesturePreviewSink } from "../../src/renderer/render/gesture-controller";
import { defaultCanvasView, SelectionState, type SelectedPort } from "../../src/renderer/render/view";
import type { Command } from "../../src/renderer/commands/command";

function makeHarness(initialDoc: TecscdeDocument) {
  let history = History.begin(initialDoc);
  let selection = SelectionState.empty();
  const messages: string[] = [];
  const dispatched: Command[] = [];
  const host: GestureHost = {
    getDocument: () => history.current,
    getView: () => defaultCanvasView(),
    getSelection: () => selection,
    setSelection: (s) => { selection = s; },
    getMode: () => "select",
    getActiveCelltypeName: () => undefined,
    dispatch: (cmd) => {
      dispatched.push(cmd);
      history = history.commit(cmd);
    },
    requestRender: () => {},
    postMessage: (msg) => { messages.push(msg); },
  };
  const sink: GesturePreviewSink = {
    screenToModel: (p) => p,
    setDragPreview: () => {},
    clearDragPreview: () => {},
    renderSelectionBox: () => {},
    setJoinBarPreview: () => {},
    clearJoinBarPreview: () => {},
  };
  const gesture = new GestureController(sink, host);
  return {
    gesture,
    doc: () => history.current,
    history: () => history,
    undo: () => { history = history.undo(); },
    redo: () => { history = history.redo(); },
    selection: () => selection,
    setSelection: (s: SelectionState) => { selection = s; },
    messages,
    dispatched,
  };
}

function portRef(cellId: ReturnType<typeof asCellId>, port: CPort | EPort): SelectedPort {
  return {
    kind: port instanceof CPort ? "cport" : "eport",
    cellId,
    portName: port.name,
    subscript: port.subscript,
    portId: port.id,
  };
}

function buildScenarioDoc(options?: { readonly cellHeight?: number; readonly callerEditable?: boolean; readonly readerEditable?: boolean }) {
  const height = options?.cellHeight ?? 25;
  const callerId = asCellId("Caller");
  const targetId = asCellId("Target");
  const roCallerId = asCellId("RoCaller");

  const cVar0 = CPort.create({ id: asPortId("cVar:0"), name: "cVar", signature: "sSig", edgeSide: "RIGHT", offset: 4, subscript: 0, arraySize: null, arrayKind: "variable" });
  const cVar1 = CPort.create({ id: asPortId("cVar:1"), name: "cVar", signature: "sSig", edgeSide: "RIGHT", offset: 8, subscript: 1, arraySize: null, arrayKind: "variable" });
  const cVar2 = CPort.create({ id: asPortId("cVar:2"), name: "cVar", signature: "sSig", edgeSide: "RIGHT", offset: 12, subscript: 2, arraySize: null, arrayKind: "variable" });
  const cOther = CPort.create({ id: asPortId("cOther"), name: "cOther", signature: "sSig", edgeSide: "RIGHT", offset: 14, subscript: null, arraySize: null, arrayKind: "none" });
  const cFixed0 = CPort.create({ id: asPortId("cFixed:0"), name: "cFixed", signature: "sSig", edgeSide: "LEFT", offset: 5, subscript: 0, arraySize: 2, arrayKind: "fixed" });
  const cFixed1 = CPort.create({ id: asPortId("cFixed:1"), name: "cFixed", signature: "sSig", edgeSide: "LEFT", offset: 10, subscript: 1, arraySize: 2, arrayKind: "fixed" });
  const cUnres = CPort.create({ id: asPortId("cUnres"), name: "cUnres", signature: "sSig", edgeSide: "LEFT", offset: 15, subscript: null, arraySize: null, arrayKind: "unresolved" });

  const eVar0 = EPort.create({ id: asPortId("eVar:0"), name: "eVar", signature: "sSig", edgeSide: "LEFT", offset: 4, subscript: 0, arraySize: null, arrayKind: "variable" });
  const eVar1 = EPort.create({ id: asPortId("eVar:1"), name: "eVar", signature: "sSig", edgeSide: "LEFT", offset: 8, subscript: 1, arraySize: null, arrayKind: "variable" });
  const eTarget = EPort.create({ id: asPortId("eTarget"), name: "eTarget", signature: "sSig", edgeSide: "LEFT", offset: 16, subscript: null, arraySize: null, arrayKind: "none" });

  const j1Id = asJoinId("Caller.cVar[1]");
  const j1 = Join.create(j1Id, callerId, cVar1, targetId, eTarget, [{ direction: "H", fixed: 8, from: 25, to: 60 }]);

  const roCall = CPort.create({ id: asPortId("roCall"), name: "cRo", signature: "sSig", edgeSide: "RIGHT", offset: 8, subscript: null, arraySize: null, arrayKind: "none" });
  const jRoId = asJoinId("RoCaller.cRo");
  const jRo = Join.create(jRoId, roCallerId, roCall, targetId, eVar1, [{ direction: "H", fixed: 8, from: 25, to: 60 }]);

  const caller = Cell.create({
    id: callerId,
    name: "Caller",
    celltypeName: "tCaller",
    x: 0,
    y: 0,
    width: 25,
    height,
    regionId: ROOT_REGION_ID,
    editable: options?.callerEditable ?? true,
    cports: [cVar0, cVar1.withJoin(j1Id), cVar2, cOther, cFixed0, cFixed1, cUnres],
    eports: [],
    attrs: {},
    celltypeUnresolved: false,
  });

  const target = Cell.create({
    id: targetId,
    name: "Target",
    celltypeName: "tTarget",
    x: 60,
    y: 0,
    width: 25,
    height,
    regionId: ROOT_REGION_ID,
    editable: true,
    cports: [],
    eports: [eVar0, eVar1.withJoin(jRoId), eTarget.withJoin(j1Id)],
    attrs: {},
    celltypeUnresolved: false,
  });

  const roCaller = Cell.create({
    id: roCallerId,
    name: "RoCaller",
    celltypeName: "tRo",
    x: 0,
    y: 40,
    width: 25,
    height: 15,
    regionId: ROOT_REGION_ID,
    editable: options?.readerEditable ?? false,
    cports: [roCall.withJoin(jRoId)],
    eports: [],
    attrs: {},
    celltypeUnresolved: false,
  });

  return {
    doc: TecscdeDocument.empty().withCell(caller).withCell(target).withCell(roCaller).withJoin(j1).withJoin(jRo),
    callerId,
    targetId,
    roCallerId,
    j1Id,
    jRoId,
  };
}

describe("V0.3.2 Stage 2: 配列要素の Insert / Delete 仕様適合 (6-1〜6-5)", () => {
  it("6-1: 結合済み可変長配列要素への Delete は1回目で結合だけを外し（選択維持）、2回目で要素を削除する", () => {
    const { doc, callerId, j1Id } = buildScenarioDoc();
    const h = makeHarness(doc);
    const cVar1 = doc.getCell(callerId)!.findCPort("cVar", 1)!;
    h.setSelection(SelectionState.ofPort(portRef(callerId, cVar1)));

    // 1回目 Delete: 結合だけ削除され、要素は残る・ポート選択も維持される
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.doc().getJoin(j1Id)).toBeUndefined();
    expect(h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
    expect(h.selection().ports).toHaveLength(1);
    expect(h.selection().ports[0]!.portId).toBe(cVar1.id);

    // 2回目 Delete: 未結合になった cVar[1] が削除され、cVar[2] が [1] へ詰まり、その PortId は維持される
    const cVar2Id = doc.getCell(callerId)!.findCPort("cVar", 2)!.id;
    expect(h.gesture.keyDown("Delete")).toBe(true);
    const remaining = h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar");
    expect(remaining.map((p) => [p.id, p.subscript])).toEqual([
      [asPortId("cVar:0"), 0],
      [cVar2Id, 1],
    ]);
    expect(h.selection().ports).toHaveLength(0);

    // 1回の Undo で要素削除だけ戻り、2回目の Undo で結合も戻る（2段階が別履歴）
    h.undo();
    expect(h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
    expect(h.doc().getJoin(j1Id)).toBeUndefined();
    h.undo();
    expect(h.doc().getJoin(j1Id)).toBeDefined();
  });

  it("6-2: 削除可能要素と拒否対象（添字0・固定長・非配列・未解決）が混在すると計画全体を拒否し部分削除しない", () => {
    const { doc, callerId } = buildScenarioDoc();
    const h = makeHarness(doc);
    const caller = doc.getCell(callerId)!;
    const cVar0 = caller.findCPort("cVar", 0)!;
    const cVar2 = caller.findCPort("cVar", 2)!; // 未結合・削除可能
    const cFixed1 = caller.findCPort("cFixed", 1)!;
    const cUnres = caller.findCPort("cUnres", null)!;

    // 添字0 + 削除可能な添字2 の混在 → 全体拒否
    h.setSelection(SelectionState.ofPorts([portRef(callerId, cVar0), portRef(callerId, cVar2)]));
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages.at(-1)).toContain("先頭要素は削除できません");
    expect(h.selection().ports).toHaveLength(2);

    // 固定長 + 削除可能 の混在 → 全体拒否
    h.setSelection(SelectionState.ofPorts([portRef(callerId, cFixed1), portRef(callerId, cVar2)]));
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
    expect(h.messages.at(-1)).toContain("固定長配列");

    // 未解決サイズ + 削除可能 の混在 → 全体拒否
    h.setSelection(SelectionState.ofPorts([portRef(callerId, cUnres), portRef(callerId, cVar2)]));
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.doc().getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
    expect(h.messages.at(-1)).toContain("未解決");
  });

  it("6-2: 読み取り専用セルのポートへの Delete は無通知にせず拒否理由を通知する", () => {
    const { doc, callerId } = buildScenarioDoc({ callerEditable: false });
    const h = makeHarness(doc);
    const cVar2 = doc.getCell(callerId)!.findCPort("cVar", 2)!;
    h.setSelection(SelectionState.ofPort(portRef(callerId, cVar2)));

    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages.at(-1)).toContain("読み取り専用");
  });

  it("6-3・6-4: Insert は単独キーのみ有効（Shift/Ctrl/Alt/Meta・操作中は無視）で、選択なし・複数選択・固定長・未解決・非配列・読取専用は通知して拒否する", () => {
    const { doc, callerId } = buildScenarioDoc();
    const h = makeHarness(doc);
    const caller = doc.getCell(callerId)!;
    const cVar0 = caller.findCPort("cVar", 0)!;
    const cVar2 = caller.findCPort("cVar", 2)!;
    const cFixed0 = caller.findCPort("cFixed", 0)!;
    const cUnres = caller.findCPort("cUnres", null)!;
    const cOther = caller.findCPort("cOther", null)!;

    // 選択なし → 通知して拒否
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages.at(-1)).toContain("1つだけ選択");

    // 複数選択 → 通知して拒否
    h.setSelection(SelectionState.ofPorts([portRef(callerId, cVar0), portRef(callerId, cVar2)]));
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages.at(-1)).toContain("1つだけ選択");

    // Shift+Insert / Ctrl+Insert / Alt+Insert / Meta+Insert → 横取りせず false
    h.setSelection(SelectionState.ofPort(portRef(callerId, cVar0)));
    expect(h.gesture.keyDown("Insert", { ctrl: false, shift: true, meta: false, alt: false })).toBe(false);
    expect(h.gesture.keyDown("Insert", { ctrl: true, shift: false, meta: false, alt: false })).toBe(false);
    expect(h.gesture.keyDown("Insert", { ctrl: false, shift: false, meta: false, alt: true })).toBe(false);
    expect(h.gesture.keyDown("Insert", { ctrl: false, shift: false, meta: true, alt: false })).toBe(false);
    expect(h.dispatched).toHaveLength(0);

    // 固定長・未解決・非配列 → それぞれ拒否通知
    h.setSelection(SelectionState.ofPort(portRef(callerId, cFixed0)));
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.messages.at(-1)).toContain("固定長配列");

    h.setSelection(SelectionState.ofPort(portRef(callerId, cUnres)));
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.messages.at(-1)).toContain("未解決");

    h.setSelection(SelectionState.ofPort(portRef(callerId, cOther)));
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.messages.at(-1)).toContain("配列ポートではありません");
  });

  it("6-5: Insert の位置調整は同じ配列グループ内に限定し、同じ辺の無関係ポートを動かさない。辺に収まらないときは挿入全体を拒否する", () => {
    const { doc, callerId } = buildScenarioDoc({ cellHeight: 25 });
    const h = makeHarness(doc);
    const caller = doc.getCell(callerId)!;
    const cVar0 = caller.findCPort("cVar", 0)!;
    const cOtherBefore = caller.findCPort("cOther", null)!.offset;

    h.setSelection(SelectionState.ofPort(portRef(callerId, cVar0)));
    expect(h.gesture.keyDown("Insert")).toBe(true);

    const after = h.doc().getCell(callerId)!;
    expect(after.cports.filter((p) => p.name === "cVar")).toHaveLength(4);
    // 同じ辺(RIGHT)にある別ポート cOther は一切動かない
    expect(after.findCPort("cOther", null)!.offset).toBe(cOtherBefore);
    // 選択は既存の対象要素 ID（cVar:0）を維持
    expect(h.selection().ports[0]!.portId).toBe(cVar0.id);

    // 辺が短く収まらないケース（高さ 6mm、既に 3 要素で 3mm 間隔上限）→ 配置不能で拒否
    const { doc: tightDoc, callerId: tightId } = buildScenarioDoc({ cellHeight: 6 });
    const tightPort0 = tightDoc.getCell(tightId)!.findCPort("cVar", 0)!;
    const planRes = prepareArrayPortInsertion(tightDoc, [portRef(tightId, tightPort0)]);
    expect(planRes.ok).toBe(false);
    if (!planRes.ok) {
      expect(planRes.reason).toBe("no-space");
    }
  });

  it("4E.5・4F.5: 受け口配列の添字変更で読み取り専用参照元の更新が必要な場合は計画全体を拒否する", () => {
    const { doc, targetId } = buildScenarioDoc({ readerEditable: false });
    const eVar0 = doc.getCell(targetId)!.findEPort("eVar", 0)!;

    // eVar[0] の直後へ挿入すると eVar[1]（読み取り専用 RoCaller.cRo が参照）の添字が変わるため拒否
    const ins = prepareArrayPortInsertion(doc, [portRef(targetId, eVar0)]);
    expect(ins.ok).toBe(false);
    if (!ins.ok) expect(ins.reason).toBe("readonly-reference");
  });

  it("4E.3・4F.3: 計画の二重適用は no-op になり、Undo/Redo で同一 PortId と結合が復元される", () => {
    const { doc, callerId } = buildScenarioDoc();
    const cVar0 = doc.getCell(callerId)!.findCPort("cVar", 0)!;
    const insRes = prepareArrayPortInsertion(doc, [portRef(callerId, cVar0)]);
    expect(insRes.ok).toBe(true);
    if (!insRes.ok) return;

    const cmd = new InsertArrayPortElementCommand(insRes.plan);
    const once = cmd.apply(doc);
    expect(cmd.apply(once)).toBe(once); // 二重適用は no-op

    // 挿入した要素（未結合・subscript=1）を DeleteArrayPortElementsCommand で削除し、二重適用 no-op を確認
    const inserted = once.getCell(callerId)!.findCPortById(insRes.plan.newPortId)!;
    const delRes = prepareArrayPortElementDeletion(once, [portRef(callerId, inserted)]);
    expect(delRes.ok).toBe(true);
    if (!delRes.ok) return;

    const delCmd = new DeleteArrayPortElementsCommand(delRes.plan);
    const afterDel = delCmd.apply(once);
    expect(delCmd.apply(afterDel)).toBe(afterDel); // 二重適用は no-op
    expect(afterDel.getCell(callerId)!.cports.filter((p) => p.name === "cVar")).toHaveLength(3);
  });
});

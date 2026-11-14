// [[TECSCDE-DT-EL内部仕様]] 第5章5.3節 — `GestureController` の状態機械をヘッドレスで検証する。
// DOM結線（`attach`）は使わず、`pointerDown`/`pointerMove`/`pointerUp`/`keyDown` を直接呼ぶ。
// host は発行されたコマンドを記録しつつ即座に apply して次の操作へ反映するスタブ。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asJoinId, type CellId } from "../../src/renderer/model/ids";
import { TecscdeDocument } from "../../src/renderer/model/document";
import type { Command } from "../../src/renderer/commands/command";
import { DeleteJoinCommand } from "../../src/renderer/commands";
import {
  AddCellCommand,
  ChangePortEdgeCommand,
  CreateJoinCommand,
  DeleteCommand,
  InsertPortElementCommand,
  MoveCellsCommand,
  MoveJoinBarCommand,
  MovePortsCommand,
} from "../../src/renderer/commands";
import { alignRound } from "../../src/renderer/model/align";
import { portPosition } from "../../src/renderer/model/geometry";
import {
  GestureController,
  type GestureHost,
  type GesturePreviewSink,
} from "../../src/renderer/render/gesture-controller";
import { SelectionState, defaultCanvasView } from "../../src/renderer/render/view";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const CONTROLLER = asCellId("cController1");
const LOGGER = asCellId("cLogger1");

const noopSink: GesturePreviewSink = {
  setDragPreview() {},
  clearDragPreview() {},
  setJoinBarPreview() {},
  clearJoinBarPreview() {},
  renderSelectionBox() {},
  screenToModel: (px) => px,
};

interface Harness {
  readonly gesture: GestureController;
  readonly dispatched: Command[];
  readonly messages: string[];
  doc(): TecscdeDocument;
  selection(): SelectionState;
  setSelection(sel: SelectionState): void;
}

function harness(
  opts: { doc?: TecscdeDocument; mode?: "select" | "newCell"; celltype?: string; sink?: GesturePreviewSink } = {},
): Harness {
  let doc = opts.doc ?? loadDoc();
  let selection = SelectionState.empty();
  const dispatched: Command[] = [];
  const messages: string[] = [];
  const host: GestureHost = {
    getDocument: () => doc,
    getView: () => defaultCanvasView(),
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
    dispatch: (c) => {
      dispatched.push(c);
      doc = c.apply(doc);
    },
    getMode: () => opts.mode ?? "select",
    getActiveCelltypeName: () => opts.celltype,
    postMessage: (m) => {
      messages.push(m);
    },
    requestRender: () => {},
  };
  return {
    gesture: new GestureController(opts.sink ?? noopSink, host),
    dispatched,
    messages,
    doc: () => doc,
    selection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
}

describe("newCell mode", () => {
  it("adds a cell to the selected editable CDL", () => {
    const referencePath = "/project/reference.cdl";
    const doc = CdlDocumentLoader.loadSources([
      { text: "signature s { void run(void); }; celltype tRef { entry s e; }; cell tRef Ref {};", fileName: "reference.cdl", sourcePath: referencePath, editable: true },
      { text: "signature sMain { void run(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};", fileName: "main.cdl", sourcePath: "/project/main.cdl", editable: true },
    ]).document;
    const h = harness({ doc, mode: "newCell", celltype: "tRef" });
    h.setSelection(SelectionState.ofCells([asCellId("Ref")]));

    h.gesture.pointerDown({ x: 300, y: 200 });

    const added = h.doc().cellValues().find((cell) => cell.name !== "Ref" && cell.name !== "Main");
    expect(added?.locale).toBe(referencePath);
  });

  it("dispatches AddCellCommand on an empty-space click when a celltype is active", () => {
    const h = harness({ mode: "newCell", celltype: "tController" });
    h.gesture.pointerDown({ x: 300, y: 200 });
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(AddCellCommand);
    expect(h.doc().cellCount).toBe(4);
  });

  it("does nothing but asks to pick a celltype when none is active (#17)", () => {
    const h = harness({ mode: "newCell" });
    h.gesture.pointerDown({ x: 300, y: 200 });
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages).toEqual(["パレットでセルタイプを選択してください"]);
  });
});

describe("select mode — cell drag", () => {
  it("selects the cell on press and commits one MoveCellsCommand with the aligned delta on release", () => {
    const h = harness();
    h.gesture.pointerDown({ x: 130, y: 15 });
    expect(h.selection().hasCell(CONTROLLER)).toBe(true);
    expect(h.gesture.stateKind).toBe("movingCells");

    h.gesture.pointerMove({ x: 135, y: 18 });
    h.gesture.pointerUp({ x: 137, y: 20 }); // delta (7,5) after ALIGN rounding

    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(MoveCellsCommand);
    expect(h.doc().getCell(CONTROLLER)!.x).toBe(127);
    expect(h.doc().getCell(CONTROLLER)!.y).toBe(15);
    expect(h.gesture.stateKind).toBe("idle");
  });

  it("does not dispatch when the drag ends without moving past the grid", () => {
    const h = harness();
    h.gesture.pointerDown({ x: 130, y: 15 });
    h.gesture.pointerUp({ x: 130.3, y: 15.2 });
    expect(h.dispatched).toHaveLength(0);
  });
});

describe("select mode — joining", () => {
  it("an already-joined call port only highlights (no joining state)", () => {
    const h = harness();
    h.gesture.pointerDown({ x: 120, y: 15 }); // cController1.cLog — already joined in the fixture
    expect(h.gesture.stateKind).toBe("idle");
    expect(h.selection().isEmpty).toBe(true);
  });

  it("drags a free call port to a matching entry port and dispatches CreateJoinCommand", () => {
    const freed = new DeleteJoinCommand(asJoinId("cController1.cLog")).apply(loadDoc());
    const h = harness({ doc: freed });

    h.gesture.pointerDown({ x: 120, y: 15 }); // cLog is now free
    expect(h.gesture.stateKind).toBe("joining");

    h.gesture.pointerMove({ x: 60, y: 16 });
    h.gesture.pointerUp({ x: 35, y: 18 }); // onto cLogger1.eLog

    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(CreateJoinCommand);
    expect(h.doc().joinCount).toBe(2);
    expect(h.gesture.stateKind).toBe("idle");
  });

  it("Escape cancels an in-progress join", () => {
    const freed = new DeleteJoinCommand(asJoinId("cController1.cLog")).apply(loadDoc());
    const h = harness({ doc: freed });
    h.gesture.pointerDown({ x: 120, y: 15 });
    expect(h.gesture.stateKind).toBe("joining");
    expect(h.gesture.keyDown("Escape")).toBe(true);
    expect(h.gesture.stateKind).toBe("idle");
    expect(h.dispatched).toHaveLength(0);
  });
});

describe("select mode — ports", () => {
  it("selects entry ports with an ordinary click and permits selection on read-only cells", () => {
    const doc = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: false },
    ]).document;
    const h = harness({ doc });
    h.gesture.pointerDown({ x: 35, y: 18 });
    h.gesture.pointerUp({ x: 35, y: 18 });
    expect(h.selection().ports).toEqual([{ kind: "eport", cellId: LOGGER, portName: "eLog", subscript: null }]);
    expect(h.selection().cellIds.size).toBe(0);
    expect(h.gesture.stateKind).toBe("idle");
    expect(h.dispatched).toHaveLength(0);
  });

  it("adds same-cell ports with Shift, toggles with Ctrl, and replaces ports from another cell", () => {
    const h = harness();
    const shift = { ctrl: false, shift: true, meta: false };
    h.setSelection(SelectionState.ofCells([LOGGER]));
    h.gesture.pointerDown({ x: 120, y: 15 }, shift);
    h.gesture.pointerUp({ x: 120, y: 15 });
    h.gesture.pointerDown({ x: 120, y: 20 }, shift);
    h.gesture.pointerUp({ x: 120, y: 20 });
    expect(h.selection().ports.map((port) => port.portName)).toEqual(["cLog", "cSensor"]);
    expect(h.selection().cellIds.size).toBe(0);
    h.gesture.pointerDown({ x: 120, y: 15 }, { ctrl: true, shift: false, meta: false });
    expect(h.selection().ports.map((port) => port.portName)).toEqual(["cSensor"]);
    h.gesture.pointerDown({ x: 35, y: 18 }, shift);
    expect(h.selection().ports).toEqual([{ kind: "eport", cellId: LOGGER, portName: "eLog", subscript: null }]);
    h.gesture.pointerDown({ x: 130, y: 15 }, shift);
    expect(h.selection().ports).toHaveLength(0);
    expect(h.selection().hasCell(CONTROLLER)).toBe(true);
    expect(h.dispatched).toHaveLength(0);
  });

  it("selects a free call port on click without committing an edit and still allows drag-to-join", () => {
    const freed = new DeleteJoinCommand(asJoinId("cController1.cLog")).apply(loadDoc());
    const h = harness({ doc: freed });
    h.gesture.pointerDown({ x: 120, y: 15 });
    h.gesture.pointerUp({ x: 120, y: 15 });
    expect(h.selection().ports[0]?.portName).toBe("cLog");
    expect(h.dispatched).toHaveLength(0);
    h.gesture.pointerDown({ x: 120, y: 15 });
    h.gesture.pointerMove({ x: 35, y: 18 });
    h.gesture.pointerUp({ x: 35, y: 18 });
    expect(h.dispatched).toHaveLength(1);
    expect(h.doc().joinCount).toBe(2);
  });

  it("does not commit empty delete or move commands for a port-only selection without joins", () => {
    const h = harness();
    // まず eLog に接続されている結合を削除してフリーポートにする
    h.setSelection(
      SelectionState.ofPort({
        kind: "eport",
        cellId: LOGGER,
        portName: "eLog",
        subscript: null,
      }),
    );
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.dispatched).toHaveLength(1);

    // 結合のない eLog を再度選択
    h.setSelection(
      SelectionState.ofPort({
        kind: "eport",
        cellId: LOGGER,
        portName: "eLog",
        subscript: null,
      }),
    );
    const selection = h.selection();
    for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowUp"]) expect(h.gesture.keyDown(key)).toBe(false);
    expect(h.selection()).toBe(selection);
    expect(h.dispatched).toHaveLength(1);
  });
});

describe("select mode — join bar drag", () => {
  it("commits one MoveJoinBarCommand for a middle bar", () => {
    const h = harness();
    // cController1.cLog の経路は他のセルを避けて自動生成される（外部仕様7.3.2）ため、座標を決め打ちせず、
    // 途中バーのうち最も長いものの中点を掴んで、バーに直交する向きへ動かす。
    const bars = h.doc().getJoin(asJoinId("cController1.cLog"))!.bars;
    let index = 1;
    for (let i = 1; i < bars.length - 1; i += 1) {
      if (Math.abs(bars[i]!.to - bars[i]!.from) > Math.abs(bars[index]!.to - bars[index]!.from)) index = i;
    }
    const bar = bars[index]!;
    const mid = (bar.from + bar.to) / 2;
    const at = (shift: number) =>
      bar.direction === "H" ? { x: mid, y: bar.fixed + shift } : { x: bar.fixed + shift, y: mid };
    h.gesture.pointerDown(at(0));
    expect(h.gesture.stateKind).toBe("movingJoinBar");
    h.gesture.pointerMove(at(7));
    h.gesture.pointerUp(at(10));
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(MoveJoinBarCommand);
  });

  it("adds joins with Shift, toggles with Ctrl, and replaces without modifiers (spec 6.2.2)", () => {
    const h = harness();
    const join1Id = asJoinId("cController1.cLog");
    const join2Id = asJoinId("cController1.cSensor");

    const bar1 = h.doc().getJoin(join1Id)!.bars[1]!;
    const pt1 = bar1.direction === "H"
      ? { x: (bar1.from + bar1.to) / 2, y: bar1.fixed }
      : { x: bar1.fixed, y: (bar1.from + bar1.to) / 2 };

    const bar2 = h.doc().getJoin(join2Id)!.bars[1]!;
    const pt2 = bar2.direction === "H"
      ? { x: (bar2.from + bar2.to) / 2, y: bar2.fixed }
      : { x: bar2.fixed, y: (bar2.from + bar2.to) / 2 };

    // 1. 通常クリックで結合1を選択
    h.gesture.pointerDown(pt1);
    h.gesture.pointerUp(pt1);
    expect(h.selection().joinIds.size).toBe(1);
    expect(h.selection().hasJoin(join1Id)).toBe(true);

    // 2. Shift+クリックで結合2を追加
    h.gesture.pointerDown(pt2, { ctrl: false, shift: true, meta: false });
    h.gesture.pointerUp(pt2);
    expect(h.selection().joinIds.size).toBe(2);
    expect(h.selection().hasJoin(join1Id)).toBe(true);
    expect(h.selection().hasJoin(join2Id)).toBe(true);

    // 3. Ctrl+クリックで結合1を解除
    h.gesture.pointerDown(pt1, { ctrl: true, shift: false, meta: false });
    h.gesture.pointerUp(pt1);
    expect(h.selection().joinIds.size).toBe(1);
    expect(h.selection().hasJoin(join1Id)).toBe(false);
    expect(h.selection().hasJoin(join2Id)).toBe(true);

    // 4. Ctrl+クリックで結合1を再選択
    h.gesture.pointerDown(pt1, { ctrl: true, shift: false, meta: false });
    h.gesture.pointerUp(pt1);
    expect(h.selection().joinIds.size).toBe(2);
    expect(h.selection().hasJoin(join1Id)).toBe(true);
    expect(h.selection().hasJoin(join2Id)).toBe(true);

    // 5. Delete キーで複数選択された結合を一括削除
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.doc().getJoin(join1Id)).toBeUndefined();
    expect(h.doc().getJoin(join2Id)).toBeUndefined();
    expect(h.selection().isEmpty).toBe(true);
  });
});

describe("keyboard", () => {
  it("Delete removes the current selection via DeleteCommand and clears it", () => {
    const h = harness();
    h.setSelection(SelectionState.ofCells([LOGGER]));
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.dispatched[0]).toBeInstanceOf(DeleteCommand);
    expect(h.selection().isEmpty).toBe(true);
  });

  it("Delete with an empty selection is a no-op", () => {
    const h = harness();
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.dispatched).toHaveLength(0);
  });

  it("arrow keys nudge the selected cells by one ALIGN unit", () => {
    const h = harness();
    h.setSelection(SelectionState.ofCells([CONTROLLER]));
    expect(h.gesture.keyDown("ArrowRight")).toBe(true);
    const cmd = h.dispatched[0];
    expect(cmd).toBeInstanceOf(MoveCellsCommand);
    expect(h.doc().getCell(CONTROLLER)!.x).toBe(121);
  });

  it("Insert key dispatches InsertPortElementCommand on variable array port", () => {
    const doc = CdlDocumentLoader.loadSources([
      {
        text: `
signature sSig { void run(void); };
celltype tArray {
  call sSig cPort[];
};
cell tArray Cell1 {};
`,
        fileName: "main.cdl",
        sourcePath: "/project/main.cdl",
        editable: true,
      },
    ]).document;

    // 可変長配列ポート cPort[0] を追加してセルを構成
    const cellId = asCellId("Cell1");
    const cport0 = doc.getCell(cellId)!.cports[0]!.withSubscript(0);
    const updatedDoc = doc.withCell(doc.getCell(cellId)!.withCPorts([cport0]));

    const h = harness({ doc: updatedDoc });
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId,
        portName: "cPort",
        subscript: 0,
      }),
    );

    // Insert (after)
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(InsertPortElementCommand);
    expect(h.doc().getCell(cellId)!.cports).toHaveLength(2);

    // Shift+Insert (before)
    expect(h.gesture.keyDown("Insert", { ctrl: false, shift: true, meta: false })).toBe(true);
    expect(h.dispatched).toHaveLength(2);
    expect(h.doc().getCell(cellId)!.cports).toHaveLength(3);
  });

  it("Insert key warns when port is not an array port", () => {
    const h = harness();
    // cLogger1 の受け口 eLog (非配列)
    h.setSelection(
      SelectionState.ofPort({
        kind: "eport",
        cellId: LOGGER,
        portName: "eLog",
        subscript: null,
      }),
    );
    expect(h.gesture.keyDown("Insert")).toBe(true);
    expect(h.dispatched).toHaveLength(0);
    expect(h.messages).toContain("配列ポートではありません");
  });

  it("Delete key deletes variable array port member with subscript > 0 and warns for subscript 0", () => {
    const doc = CdlDocumentLoader.loadSources([
      {
        text: `
signature sSig { void run(void); };
celltype tArray {
  call sSig cPort[];
};
cell tArray Cell1 {};
`,
        fileName: "main.cdl",
        sourcePath: "/project/main.cdl",
        editable: true,
      },
    ]).document;

    const cellId = asCellId("Cell1");
    const cport0 = doc.getCell(cellId)!.cports[0]!.withSubscript(0);
    const cport1 = doc.getCell(cellId)!.cports[0]!.withSubscript(1);
    const updatedDoc = doc.withCell(doc.getCell(cellId)!.withCPorts([cport0, cport1]));

    const h = harness({ doc: updatedDoc });

    // 添字0 の削除拒否メッセージ
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId,
        portName: "cPort",
        subscript: 0,
      }),
    );
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.messages).toContain("先頭要素は削除できません");
    expect(h.dispatched).toHaveLength(0);

    // 添字1 の削除成功
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId,
        portName: "cPort",
        subscript: 1,
      }),
    );
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.dispatched).toHaveLength(1);
    expect(h.doc().getCell(cellId)!.cports).toHaveLength(1);
  });

  it("deletes connected join when call port is selected (spec 6.3.2)", () => {
    const h = harness();
    const joinId = asJoinId("cController1.cLog");
    expect(h.doc().getJoin(joinId)).toBeDefined();

    // 呼び口 cLog を選択して Delete
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId: CONTROLLER,
        portName: "cLog",
        subscript: null,
      }),
    );

    const handled = h.gesture.keyDown("Delete");
    expect(handled).toBe(true);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(DeleteCommand);
    expect(h.doc().getJoin(joinId)).toBeUndefined();
    expect(h.doc().getCell(CONTROLLER)!.findCPort("cLog")!.joinId).toBeNull();
    expect(h.selection().isEmpty).toBe(true);
  });

  it("deletes connected joins when entry port is selected (spec 6.3.2)", () => {
    const h = harness();
    const joinId = asJoinId("cController1.cLog");
    expect(h.doc().getJoin(joinId)).toBeDefined();

    // 受け口 eLog を選択して Delete
    h.setSelection(
      SelectionState.ofPort({
        kind: "eport",
        cellId: LOGGER,
        portName: "eLog",
        subscript: null,
      }),
    );

    const handled = h.gesture.keyDown("Delete");
    expect(handled).toBe(true);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(DeleteCommand);
    expect(h.doc().getJoin(joinId)).toBeUndefined();
    expect(h.doc().getCell(LOGGER)!.findEPort("eLog")!.joinIds).toEqual([]);
    expect(h.selection().isEmpty).toBe(true);
  });

  it("does not delete or dispatch when port has no connected joins and cannot be deleted", () => {
    const h = harness();
    const joinId = asJoinId("cController1.cLog");
    // 結合を削除済みにする
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId: CONTROLLER,
        portName: "cLog",
        subscript: null,
      }),
    );
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.doc().getJoin(joinId)).toBeUndefined();

    // 再度 cLog を選択して Delete -> 結合がなく単一ポートなので削除できず false
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId: CONTROLLER,
        portName: "cLog",
        subscript: null,
      }),
    );
    expect(h.gesture.keyDown("Delete")).toBe(false);
    expect(h.dispatched).toHaveLength(1); // 1回目のdispatchのみ
  });

  it("deletes join connected to array port subscript 0 without showing rejection message", () => {
    const doc = loadDoc();
    const cellId = CONTROLLER;
    const cell = doc.getCell(cellId)!;

    // cLog ポートの結合IDを取得
    const joinId = asJoinId("cController1.cLog");
    expect(doc.getJoin(joinId)).toBeDefined();

    // cLog を添字0の配列ポートに模倣して設定
    const cport = cell.findCPort("cLog")!;
    const updatedCPorts = cell.cports.map((p) =>
      p.name === "cLog" ? p.withSubscript(0) : p,
    );
    const updatedDoc = doc.withCell(cell.withCPorts(updatedCPorts));

    const h = harness({ doc: updatedDoc });

    // 添字0 の cLog を選択して Delete
    h.setSelection(
      SelectionState.ofPort({
        kind: "cport",
        cellId,
        portName: "cLog",
        subscript: 0,
      }),
    );

    // 結合が削除される（メッセージは出ない）
    expect(h.gesture.keyDown("Delete")).toBe(true);
    expect(h.dispatched).toHaveLength(1);
    expect(h.messages).toHaveLength(0);
    expect(h.doc().getJoin(joinId)).toBeUndefined();
    // 添字0のポート自体は残っている
    expect(h.doc().getCell(cellId)!.findCPort("cLog", 0)).toBeDefined();
    expect(h.doc().getCell(cellId)!.findCPort("cLog", 0)!.joinId).toBeNull();
  });

  it("selects all cells with Ctrl+A (spec 6.8.2)", () => {
    const h = harness();
    expect(h.selection().isEmpty).toBe(true);

    const handled = h.gesture.keyDown("a", { ctrl: true, shift: false, meta: false });
    expect(handled).toBe(true);
    expect(h.selection().cellIds.size).toBe(h.doc().cellCount);
    expect(h.selection().hasCell(CONTROLLER)).toBe(true);
    expect(h.selection().hasCell(LOGGER)).toBe(true);
    expect(h.selection().joinIds.size).toBe(0);
    expect(h.selection().ports).toHaveLength(0);

    // 空ドキュメントの場合は false
    const emptyH = harness({ doc: TecscdeDocument.empty() });
    expect(emptyH.gesture.keyDown("a", { ctrl: true, shift: false, meta: false })).toBe(false);
  });
});

describe("box selection", () => {
  it("selects every cell fully inside the drag rectangle", () => {
    const h = harness();
    h.gesture.pointerDown({ x: 5, y: 5 });
    expect(h.gesture.stateKind).toBe("boxSelect");
    h.gesture.pointerMove({ x: 200, y: 200 });
    h.gesture.pointerUp({ x: 200, y: 200 });
    const sel = h.selection();
    expect(sel.cellIds.size).toBe(3);
    const ids: CellId[] = [...sel.cellIds];
    expect(ids).toContain(CONTROLLER);
  });
});

describe("context-sensitive cursors (#15)", () => {
  it("computes appropriate cursor depending on hover target and drag state", () => {
    const h = harness();
    const doc = h.doc();
    const controller = doc.getCell(CONTROLLER)!;
    const logger = doc.getCell(LOGGER)!;

    // 空白位置では default
    expect(h.gesture.computeCursor({ x: 0, y: 0 })).toBe("default");

    // セル本体位置では move
    expect(h.gesture.computeCursor({ x: controller.x + 10, y: controller.y + 10 })).toBe("move");

    // newCell モードでは crosshair
    const newCellH = harness({ mode: "newCell", celltype: "tLogger" });
    expect(newCellH.gesture.computeCursor({ x: 0, y: 0 })).toBe("crosshair");

    // 結合バーのカーソル判定
    const join = doc.getJoin(asJoinId("cController1.cLog"))!;
    const midIndex = 1;
    const midBar = join.bars[midIndex]!;
    const barPoint = midBar.direction === "H"
      ? { x: (midBar.from + midBar.to) / 2, y: midBar.fixed }
      : { x: midBar.fixed, y: (midBar.from + midBar.to) / 2 };
    const expectedBarCursor = midBar.direction === "H" ? "ns-resize" : "ew-resize";
    expect(h.gesture.computeCursor(barPoint)).toBe(expectedBarCursor);

    // 結合ドラッグ中のカーソル判定
    // 結合を解除して cLog をフリーにする
    const freed = new DeleteJoinCommand(asJoinId("cController1.cLog")).apply(doc);
    const joinH = harness({ doc: freed });
    // cLog の位置（x: 120, y: 15）からドラッグ開始
    joinH.gesture.pointerDown({ x: 120, y: 15 });
    expect(joinH.gesture.stateKind).toBe("joining");

    // 結合操作中（空白上）は crosshair
    expect(joinH.gesture.computeCursor({ x: 50, y: 50 })).toBe("crosshair");

    // シグニチャ一致受け口の上（cLogger1 の eLog: x: 35, y: 18）は pointer
    expect(joinH.gesture.computeCursor({ x: 35, y: 18 })).toBe("pointer");

    // pointerUp で idle に復帰し default に戻る
    joinH.gesture.pointerUp({ x: 50, y: 50 });
    expect(joinH.gesture.stateKind).toBe("idle");
    expect(joinH.gesture.computeCursor({ x: 0, y: 0 })).toBe("default");
  });
});


describe("port move and edge change by Alt drag (#8)", () => {
  const ALT = { ctrl: false, shift: false, meta: false, alt: true };
  const ALT_SHIFT = { ...ALT, shift: true };

  function cLogOf(h: Harness) {
    const cell = h.doc().getCell(CONTROLLER)!;
    const port = cell.findCPort("cLog")!;
    return { cell, port, at: portPosition(cell, port) };
  }

  it("slides a joined call port along its edge with one MovePortsCommand and keeps the join", () => {
    const h = harness();
    const { cell, port, at } = cLogOf(h);
    const alongX = port.edgeSide === "TOP" || port.edgeSide === "BOTTOM";
    const length = alongX ? cell.width : cell.height;
    const delta = 5;

    h.gesture.pointerDown(at, ALT);
    expect(h.gesture.stateKind).toBe("movingPorts");
    expect(h.selection().hasPort({ kind: "cport", cellId: CONTROLLER, portName: "cLog", subscript: null })).toBe(true);
    // 辺と直交する成分は捨てられる（辺に沿った成分だけが効く）
    h.gesture.pointerUp(alongX ? { x: at.x + delta, y: at.y + 30 } : { x: at.x + 30, y: at.y + delta });

    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(MovePortsCommand);
    const moved = h.doc().getCell(CONTROLLER)!.findCPort("cLog")!;
    expect(moved.edgeSide).toBe(port.edgeSide);
    expect(moved.offset).toBe(Math.min(length, alignRound(port.offset + delta)));
    expect(moved.joinId).toBe(port.joinId);
    expect(h.gesture.stateKind).toBe("idle");
  });

  it("changes the owning edge with Alt+Shift to the edge nearest the pointer", () => {
    const h = harness();
    const { cell, at } = cLogOf(h);

    h.gesture.pointerDown(at, ALT_SHIFT);
    h.gesture.pointerUp({ x: cell.x + 10, y: cell.y + cell.height + 1 });

    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toBeInstanceOf(ChangePortEdgeCommand);
    const moved = h.doc().getCell(CONTROLLER)!.findCPort("cLog")!;
    expect(moved.edgeSide).toBe("BOTTOM");
    expect(moved.offset).toBe(alignRound(10));
  });

  it("cancels the port drag with Escape and dispatches nothing", () => {
    const h = harness();
    const { at } = cLogOf(h);
    h.gesture.pointerDown(at, ALT);
    expect(h.gesture.keyDown("Escape")).toBe(true);
    expect(h.gesture.stateKind).toBe("idle");
    expect(h.dispatched).toHaveLength(0);
  });

  it("leaves a plain drag on an unjoined call port as a join gesture", () => {
    const freed = new DeleteJoinCommand(asJoinId("cController1.cLog")).apply(loadDoc());
    const h = harness({ doc: freed });
    const { at } = cLogOf(h);
    h.gesture.pointerDown(at);
    expect(h.gesture.stateKind).toBe("joining");
  });

  it("tells the user why a plain click on a joined call port does nothing (#19)", () => {
    const h = harness();
    const { at } = cLogOf(h);
    h.gesture.pointerDown(at);
    expect(h.gesture.stateKind).toBe("idle");
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]).toContain("結合済み");
  });

  it("shows a preview mark at the destination while dragging and clears it on release", () => {
    const calls: (readonly { x: number; y: number }[] | undefined)[] = [];
    const sink: GesturePreviewSink = { ...noopSink, setPortDragPreview: (_view, positions) => calls.push(positions) };
    const h = harness({ sink });
    const { cell, port, at } = cLogOf(h);
    const alongX = port.edgeSide === "TOP" || port.edgeSide === "BOTTOM";
    const moveTo = alongX ? { x: at.x + 5, y: at.y } : { x: at.x, y: at.y + 5 };

    h.gesture.pointerDown(at, ALT);
    h.gesture.pointerMove(moveTo);
    const shown = calls.at(-1);
    expect(shown).toHaveLength(1);
    // 確定後のポート位置と同じ場所に印が出る。
    h.gesture.pointerUp(moveTo);
    const moved = h.doc().getCell(CONTROLLER)!.findCPort("cLog")!;
    expect(shown![0]).toEqual(portPosition(h.doc().getCell(CONTROLLER)!, moved));
    expect(calls.at(-1)).toBeUndefined();
    void cell;
  });

  it("clears the preview and says the move was canceled when Escape is pressed", () => {
    const calls: (readonly { x: number; y: number }[] | undefined)[] = [];
    const sink: GesturePreviewSink = { ...noopSink, setPortDragPreview: (_view, positions) => calls.push(positions) };
    const h = harness({ sink });
    const { port, at } = cLogOf(h);
    const alongX = port.edgeSide === "TOP" || port.edgeSide === "BOTTOM";
    h.gesture.pointerDown(at, ALT);
    h.gesture.pointerMove(alongX ? { x: at.x + 5, y: at.y } : { x: at.x, y: at.y + 5 });
    expect(calls.at(-1)).toHaveLength(1);

    expect(h.gesture.keyDown("Escape")).toBe(true);
    expect(calls.at(-1)).toBeUndefined();
    expect(h.messages).toEqual(["ポートの移動を取り消しました"]);

    h.gesture.pointerUp(alongX ? { x: at.x + 5, y: at.y } : { x: at.x, y: at.y + 5 });
    expect(h.dispatched).toHaveLength(0);
  });

  it("uses an edge-change wording when the canceled drag was an edge change", () => {
    const h = harness();
    const { at } = cLogOf(h);
    h.gesture.pointerDown(at, ALT_SHIFT);
    h.gesture.keyDown("Escape");
    expect(h.messages).toEqual(["ポートの辺の変更を取り消しました"]);
  });
});

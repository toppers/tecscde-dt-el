// [[TECSCDE-DT-EL内部仕様]] 第5章5.3節 — `GestureController` の状態機械をヘッドレスで検証する。
// DOM結線（`attach`）は使わず、`pointerDown`/`pointerMove`/`pointerUp`/`keyDown` を直接呼ぶ。
// host は発行されたコマンドを記録しつつ即座に apply して次の操作へ反映するスタブ。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asJoinId, type CellId } from "../../src/renderer/model/ids";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import type { Command } from "../../src/renderer/commands/command";
import { DeleteJoinCommand } from "../../src/renderer/commands";
import {
  AddCellCommand,
  CreateJoinCommand,
  DeleteCommand,
  MoveCellsCommand,
  MoveJoinBarCommand,
} from "../../src/renderer/commands";
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
  doc(): TecscdeDocument;
  selection(): SelectionState;
  setSelection(sel: SelectionState): void;
}

function harness(opts: { doc?: TecscdeDocument; mode?: "select" | "newCell"; celltype?: string } = {}): Harness {
  let doc = opts.doc ?? loadDoc();
  let selection = SelectionState.empty();
  const dispatched: Command[] = [];
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
    requestRender: () => {},
  };
  return {
    gesture: new GestureController(noopSink, host),
    dispatched,
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

  it("does nothing when no celltype is active", () => {
    const h = harness({ mode: "newCell" });
    h.gesture.pointerDown({ x: 300, y: 200 });
    expect(h.dispatched).toHaveLength(0);
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

  it("does not commit empty delete or move commands for a port-only selection", () => {
    const h = harness();
    h.gesture.pointerDown({ x: 35, y: 18 });
    const selection = h.selection();
    for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowUp"]) expect(h.gesture.keyDown(key)).toBe(false);
    expect(h.selection()).toBe(selection);
    expect(h.dispatched).toHaveLength(0);
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

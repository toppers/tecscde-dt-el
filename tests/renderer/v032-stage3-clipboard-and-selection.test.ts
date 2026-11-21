import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { serializeCellsAsCdl, serializeClipboardAsCdl, tryParseCdlFragment } from "../../src/renderer/cdl/fragment";
import { assertInvariants } from "../../src/renderer/model/invariants";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import {
  buildClipboardSnapshot,
  PasteCommand,
  pasteFromAppClipboard,
  pasteFromCdlFragment,
} from "../../src/renderer/commands";
import { AppStore } from "../../src/renderer/app/store";
import { GestureController, type GestureHost, type GesturePreviewSink } from "../../src/renderer/render/gesture-controller";
import { defaultCanvasView, SelectionState } from "../../src/renderer/render/view";
import type { Command } from "../../src/renderer/commands/command";

const SAMPLE_CDL = `
signature sSig { void f(void); };
celltype tNode {
  call sSig cOut;
  call sSig cArr[];
  entry sSig eIn;
  entry sSig eArr[];
};
cell tNode A {
  cOut = B.eIn;
  cArr[0] = B.eArr[0];
  cArr[1] = B.eArr[1];
};
cell tNode B {
  cOut = C.eIn;
};
cell tNode C {
  cOut = C.eIn;
};
`;

function loadScenario() {
  return CdlDocumentLoader.loadSources([{ text: SAMPLE_CDL, fileName: "main.cdl", editable: true }]).document;
}

describe("V0.3.2 Stage 3: 複数セルコピーでの結合保持 (6-16, #25)", () => {
  it("単一セルコピーでは外部結合も自己結合も含めない（アプリ内・OS 両経路）", () => {
    const doc = loadScenario();
    const cellA = asCellId("A");
    const cellC = asCellId("C"); // C.cOut = C.eIn の自己結合を持つ

    const snapA = buildClipboardSnapshot(doc, [cellA]);
    expect(snapA.cells).toHaveLength(1);
    expect(snapA.joins).toHaveLength(0);
    expect(serializeCellsAsCdl(doc, [cellA])).not.toContain("B.eIn");

    const snapC = buildClipboardSnapshot(doc, [cellC]);
    expect(snapC.cells).toHaveLength(1);
    expect(snapC.joins).toHaveLength(0);
    expect(serializeClipboardAsCdl(snapC)).not.toContain("C.eIn");

    const pastedC = pasteFromAppClipboard(doc, snapC);
    expect(pastedC.cellCount).toBe(doc.cellCount + 1);
    expect(pastedC.joinCount).toBe(doc.joinCount); // 自己結合は増えない
    expect(() => assertInvariants(pastedC)).not.toThrow();
  });

  it("2個以上のセル (A, B) をコピーすると選択セル間の結合（通常・配列）を保持し、選択外 C への結合は除外する", () => {
    const doc = loadScenario();
    const cellA = asCellId("A");
    const cellB = asCellId("B");

    const snap = buildClipboardSnapshot(doc, [cellA, cellB]);
    expect(snap.cells.map((c) => c.id)).toEqual([cellA, cellB]);
    // A->B の 3 本（cOut->eIn, cArr[0]->eArr[0], cArr[1]->eArr[1]）のみ。B->C は除外。
    expect(snap.joins).toHaveLength(3);
    expect(snap.joins.every((j) => j.cellId === cellA && j.eportCellId === cellB)).toBe(true);

    // アプリ内クリップボードからの貼り付け
    const pasted = pasteFromAppClipboard(doc, snap);
    expect(pasted.cellCount).toBe(doc.cellCount + 2);
    expect(pasted.joinCount).toBe(doc.joinCount + 3);
    expect(() => assertInvariants(pasted)).not.toThrow();

    const newCells = pasted.cellValues().filter((c) => c.name !== "A" && c.name !== "B" && c.name !== "C");
    expect(newCells).toHaveLength(2);
    const newCellIds = new Set(newCells.map((c) => c.id));
    const newJoins = pasted.joinValues().filter((j) => newCellIds.has(j.cellId));
    expect(newJoins).toHaveLength(3);
    // すべて複製先セル同士で結ばれ、元の A/B/C には結ばれない
    expect(newJoins.every((j) => newCellIds.has(j.eportCellId))).toBe(true);
    expect(newJoins.map((j) => `${j.cportName}${j.cportSubscript !== null ? `[${j.cportSubscript}]` : ""}->${j.eportName}${j.eportSubscript !== null ? `[${j.eportSubscript}]` : ""}`).sort()).toEqual([
      "cArr[0]->eArr[0]",
      "cArr[1]->eArr[1]",
      "cOut->eIn",
    ]);
  });

  it("OS クリップボード CDL 断片経由でも複数セル間の結合（配列添字含む）が復元され、外部セル参照は無視される", () => {
    const doc = loadScenario();
    const cellA = asCellId("A");
    const cellB = asCellId("B");

    const cdlText = serializeCellsAsCdl(doc, [cellA, cellB]);
    expect(cdlText).toContain("cOut = B.eIn;");
    expect(cdlText).toContain("cArr[0] = B.eArr[0];");
    expect(cdlText).toContain("cArr[1] = B.eArr[1];");
    expect(cdlText).not.toContain("C.eIn");

    const parsed = tryParseCdlFragment(cdlText);
    expect(parsed).toBeDefined();
    expect(parsed!).toHaveLength(2);

    const pasted = pasteFromCdlFragment(doc, parsed!);
    expect(pasted.cellCount).toBe(doc.cellCount + 2);
    expect(pasted.joinCount).toBe(doc.joinCount + 3);
    expect(() => assertInvariants(pasted)).not.toThrow();

    // 断片外の既存セル C への結合代入を含む外部テキストを貼っても、元の図の C には接続しない
    const externalText = `
cell tNode X {
  cOut = C.eIn;
};
cell tNode Y {
  cOut = X.eIn;
};
`;
    const parsedExt = tryParseCdlFragment(externalText)!;
    const pastedExt = pasteFromCdlFragment(doc, parsedExt);
    expect(pastedExt.cellCount).toBe(doc.cellCount + 2);
    // Y->X の 1 本だけ作られ、X->C は作られない
    expect(pastedExt.joinCount).toBe(doc.joinCount + 1);
    const cellC = pastedExt.getCell(asCellId("C"))!;
    expect(cellC.findEPort("eIn")!.joinIds).toEqual(doc.getCell(asCellId("C"))!.findEPort("eIn")!.joinIds);
  });

  it("AppStore の copy/paste・cut/paste は 1 回の Undo/Redo でセルと内部結合を一体で戻し、貼り付け先で1セル選択中でも内部結合を保つ", () => {
    const doc = loadScenario();
    const store = new AppStore(doc);
    let osWritten = "";
    const clipboard = {
      writeText: (t: string) => { osWritten = t; return Promise.resolve(); },
    };

    store.setSelection(SelectionState.ofCells([asCellId("A"), asCellId("B")]));
    store.copySelection(clipboard);
    expect(osWritten).toContain("cOut = B.eIn;");

    // 貼り付け先で 1 セルだけ選択していても、複数セルコピーの内部結合は維持される
    store.setSelection(SelectionState.ofCells([asCellId("C")]));
    store.pasteClipboard(undefined);
    expect(store.getDocument().cellCount).toBe(5);
    expect(store.getDocument().joinCount).toBe(doc.joinCount + 3);

    // 1回の Undo でセル2個＋結合3本がすべて戻る
    store.undo();
    expect(store.getDocument().cellCount).toBe(3);
    expect(store.getDocument().joinCount).toBe(doc.joinCount);

    // Redo で再びセル2個＋結合3本が復元される
    store.redo();
    expect(store.getDocument().cellCount).toBe(5);
    expect(store.getDocument().joinCount).toBe(doc.joinCount + 3);

    // PasteCommand の空スナップショット + OS テキストのフォールバックも同様に動作する
    const viaOs = new PasteCommand({ cells: [], joins: [] }, osWritten).apply(doc);
    expect(viaOs.cellCount).toBe(5);
    expect(viaOs.joinCount).toBe(doc.joinCount + 3);
  });
});

describe("V0.3.2 Stage 3: セルと結合バーの混在選択 (6-17)", () => {
  it("SelectionState はセルと結合バーの同時選択を許可し、ポートとの間だけ排他にする", () => {
    const a = asCellId("A");
    const b = asCellId("B");
    const j1 = asJoinId("A.cOut");
    const j2 = asJoinId("B.cOut");

    const s1 = SelectionState.ofCells([a]).withJoinAdded(j1);
    expect(s1.hasCell(a)).toBe(true);
    expect(s1.hasJoin(j1)).toBe(true);

    const s2 = s1.withCellAdded(b).withJoinToggled(j2);
    expect([...s2.cellIds]).toEqual([a, b]);
    expect([...s2.joinIds]).toEqual([j1, j2]);

    const s3 = s2.withCellToggled(a).withJoinToggled(j1);
    expect([...s3.cellIds]).toEqual([b]);
    expect([...s3.joinIds]).toEqual([j2]);

    // ポートを追加するとセル・結合バーはクリアされる（ポートとは排他）
    const sPort = s3.withPortAdded({ kind: "cport", cellId: a, portName: "cOut", subscript: null });
    expect(sPort.cellIds.size).toBe(0);
    expect(sPort.joinIds.size).toBe(0);
    expect(sPort.ports).toHaveLength(1);

    // ポート選択中にセルまたは結合を加えるとポートはクリアされる
    const backToCell = sPort.withCellAdded(a);
    expect(backToCell.ports).toHaveLength(0);
    expect(backToCell.hasCell(a)).toBe(true);
  });

  it("セルと結合バーの混在選択状態で Delete すると両方が1回の操作で削除される", () => {
    const doc = loadScenario();
    let currentDoc = doc;
    let selection = SelectionState.ofCells([asCellId("C")]).withJoinAdded(asJoinId("A.cOut"));
    const dispatched: Command[] = [];
    const host: GestureHost = {
      getDocument: () => currentDoc,
      getView: () => defaultCanvasView(),
      getSelection: () => selection,
      setSelection: (s) => { selection = s; },
      getMode: () => "select",
      getActiveCelltypeName: () => undefined,
      dispatch: (cmd) => {
        dispatched.push(cmd);
        currentDoc = cmd.apply(currentDoc);
      },
      requestRender: () => {},
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

    expect(gesture.keyDown("Delete")).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(currentDoc.getCell(asCellId("C"))).toBeUndefined();
    expect(currentDoc.getJoin(asJoinId("A.cOut"))).toBeUndefined();
    expect(selection.isEmpty).toBe(true);
    expect(() => assertInvariants(currentDoc)).not.toThrow();
  });
});

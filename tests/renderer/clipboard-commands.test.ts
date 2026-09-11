// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節 — CopyCommand/CutCommand/PasteCommandのヘッドレステスト。
// OSクリップボードは`ClipboardGateway`の同じ形の受け皿を持つスタブに差し替える
// （`writeText`は書き込まれたテキストを記録するだけ、`readText`は本テストでは未使用——
// `PasteCommand`はOS側テキストを解決済みの文字列として受け取る設計のため、ClipboardGateway.readText()
// 自体の呼び出しはAppStore側の責務であり、ここでは検証しない）。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { serializeCellsAsCdl } from "../../src/renderer/cdl/fragment";
import { assertInvariants } from "../../src/renderer/model/invariants";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { CopyCommand, CutCommand, PasteCommand, pasteFromAppClipboard } from "../../src/renderer/commands";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

function fakeClipboard() {
  let written: string | undefined;
  return {
    writeText: (text: string) => {
      written = text;
      return Promise.resolve();
    },
    get written() {
      return written;
    },
  };
}

const LOGGER = asCellId("cLogger1");
const SENSOR = asCellId("cSensor1");
const CONTROLLER = asCellId("cController1");
const JOIN_CLOG = asJoinId("cController1.cLog");

describe("CopyCommand", () => {
  it("writes a CDL fragment to the clipboard and leaves the document unchanged", () => {
    const doc = loadDoc();
    const clipboard = fakeClipboard();
    const result = new CopyCommand([LOGGER, SENSOR], clipboard).apply(doc);
    expect(result).toBe(doc); // 履歴を作らない: ドキュメントは不変
    expect(clipboard.written).toBe(serializeCellsAsCdl(doc, [LOGGER, SENSOR]));
  });
});

describe("CutCommand", () => {
  it("copies to the clipboard, then cascades delete like DeleteCommand", () => {
    const doc = loadDoc();
    const clipboard = fakeClipboard();
    const next = new CutCommand([CONTROLLER], [], clipboard).apply(doc);
    expect(clipboard.written).toBe(serializeCellsAsCdl(doc, [CONTROLLER]));
    expect(next.getCell(CONTROLLER)).toBeUndefined();
    expect(next.joinCount).toBe(0);
    expect(() => assertInvariants(next)).not.toThrow();
  });

  it("can cut a join directly (independent of any cell)", () => {
    const doc = loadDoc();
    const clipboard = fakeClipboard();
    const next = new CutCommand([], [JOIN_CLOG], clipboard).apply(doc);
    expect(next.joinCount).toBe(1);
    expect(next.getCell(CONTROLLER)!.findCPort("cLog")!.joinId).toBeNull();
  });
});

describe("PasteCommand", () => {
  it("prefers the app-internal clipboard when it has entries", () => {
    const doc = loadDoc();
    const snapshot = [doc.getCell(LOGGER)!];
    const next = new PasteCommand(snapshot, "cell tSensor ignoredBecauseAppClipboardWins { }").apply(doc);
    expect(next.cellCount).toBe(doc.cellCount + 1);
    expect(next.cellValues().some((c) => c.celltypeName === "tLogger" && c.name !== "cLogger1")).toBe(true);
  });

  it("falls back to the OS clipboard's CDL fragment when the app clipboard is empty", () => {
    const doc = loadDoc();
    const fragment = serializeCellsAsCdl(doc, [SENSOR]);
    const next = new PasteCommand([], fragment).apply(doc);
    expect(next.cellCount).toBe(doc.cellCount + 1);
    const pasted = next.cellValues().find((c) => c.celltypeName === "tSensor" && c.name !== "cSensor1");
    expect(pasted).toBeDefined();
    expect(() => assertInvariants(next)).not.toThrow();
  });

  it("no-ops when both clipboards are empty or unparseable", () => {
    const doc = loadDoc();
    expect(new PasteCommand([], undefined).apply(doc)).toBe(doc);
    expect(new PasteCommand([], "not cdl at all").apply(doc)).toBe(doc);
  });
});

describe("pasteFromAppClipboard", () => {
  it("offsets the pasted cell's position and keeps attrs, but assigns fresh ports (no joins)", () => {
    const doc = loadDoc();
    const source = doc.getCell(CONTROLLER)!;
    const next = pasteFromAppClipboard(doc, [source]);
    const pasted = next.cellValues().find((c) => c.celltypeName === "tController" && c.name !== "cController1")!;
    expect(pasted.x).toBe(source.x + 10);
    expect(pasted.y).toBe(source.y + 10);
    expect(pasted.attrs.intervalMs).toBe("100");
    expect(pasted.findCPort("cLog")!.joinId).toBeNull();
  });

  it("skips a cell whose celltype no longer resolves in the target document", () => {
    const doc = loadDoc();
    const source = doc.getCell(LOGGER)!;
    const bogus = { ...source, celltypeName: "tNoSuchType" } as typeof source;
    expect(pasteFromAppClipboard(doc, [bogus])).toBe(doc);
  });
});

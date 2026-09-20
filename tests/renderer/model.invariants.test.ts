// TECSCDE-TS内部仕様 3.3 — 不変条件の検証。#2（呼び口の結合は最大1本）は型階層で構造的に保証されるため、
// ここでは残り（#1・参照整合性）が実行時に検出されることを確認する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertInvariants, InvariantViolation } from "../../src/renderer/model/invariants";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

describe("model invariants", () => {
  it("the sample fixture satisfies all invariants after loading", () => {
    const combined = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    expect(() => assertInvariants(combined.document)).not.toThrow();
  });

  it("moveTo() always re-aligns, so an off-grid cell cannot be constructed via the public API (11.2 validation point)", () => {
    // 既存の関数ベース実装ではplain objectをspreadして直接壊せたため、この不変条件は
    // invariants.tsの事後検証に頼っていた。クラス化後はmoveTo()自体がalignRound()を
    // 強制するため、ここではassertInvariantsに頼らずとも壊れた値を作れないことを確認する。
    const { document } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    const cell = document.cellValues()[0]!;
    const moved = cell.moveTo(cell.x + 0.3, cell.y);
    expect(moved.x).toBe(cell.x); // 0.3mmはALIGN=1.0mm未満のため丸めで元の座標に戻る
    expect(() => assertInvariants(document.withCell(moved))).not.toThrow(InvariantViolation);
  });

  it("cannot construct a CPort with more than one join (guaranteed by the type, not by a validator)", () => {
    const { document } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    const controller = document.cellValues().find((c) => c.celltypeName === "tController")!;
    const cport = controller.findCPort("cLog")!;
    expect(cport.joinId).not.toBeNull();
    expect(() => cport.withJoin(cport.joinId!)).toThrow();
  });
});

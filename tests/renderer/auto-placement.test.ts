import { describe, expect, it } from "vitest";
import { placeAutoCells, type Rect } from "../../src/renderer/cdl/auto-placement";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId } from "../../src/renderer/model/ids";

// 外部仕様 5.3.x（2026-11-03）: レイアウトを持たないセルの自動配置。
// 重ならない最初の空き位置に置き、用紙に収まらないものは位置をずらして重ね、数を警告で知らせる。
const A4 = { w: 277, h: 190 }; // 内容領域（A4 横）
const CELL_W = 25;
const CELL_H = 15;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const rect = (p: { x: number; y: number }): Rect => ({ x: p.x, y: p.y, width: CELL_W, height: CELL_H });

describe("placeAutoCells", () => {
  it("lays cells out on the classic grid when nothing is in the way", () => {
    const { positions, overflow } = placeAutoCells(7, [], A4.w, A4.h);

    expect(overflow).toBe(0);
    expect(positions.slice(0, 5)).toEqual([
      { x: 10, y: 10 }, { x: 65, y: 10 }, { x: 120, y: 10 }, { x: 175, y: 10 }, { x: 230, y: 10 },
    ]);
    expect(positions[5]).toEqual({ x: 10, y: 40 }); // 次の段
    expect(positions[6]).toEqual({ x: 65, y: 40 });
  });

  it("skips grid positions that an already placed cell (e.g. one with a saved layout) would overlap", () => {
    const occupied: Rect[] = [{ x: 65, y: 10, width: CELL_W, height: CELL_H }];

    const { positions } = placeAutoCells(3, occupied, A4.w, A4.h);

    expect(positions).toEqual([{ x: 10, y: 10 }, { x: 120, y: 10 }, { x: 175, y: 10 }]);
  });

  it("treats a partial overlap as blocked, and touching edges as free", () => {
    const partly: Rect[] = [{ x: 70, y: 12, width: CELL_W, height: CELL_H }];
    expect(placeAutoCells(2, partly, A4.w, A4.h).positions).toEqual([{ x: 10, y: 10 }, { x: 120, y: 10 }]);

    const touching: Rect[] = [{ x: 35, y: 10, width: 30, height: CELL_H }]; // 10..35 と 35..65 の間に挟まる
    expect(placeAutoCells(2, touching, A4.w, A4.h).positions[1]).toEqual({ x: 65, y: 10 });
  });

  it("places 30 cells without any overlap on A4 landscape (5 columns x 6 rows)", () => {
    const { positions, overflow } = placeAutoCells(30, [], A4.w, A4.h);

    expect(overflow).toBe(0);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(overlaps(rect(positions[i]!), rect(positions[j]!))).toBe(false);
      }
    }
  });

  it("puts cells that no longer fit at shifted positions (8 mm right, 6 mm down per extra pass) and counts them", () => {
    const { positions, overflow } = placeAutoCells(33, [], A4.w, A4.h);

    expect(overflow).toBe(3);
    expect(positions[30]).toEqual({ x: 18, y: 16 });
    expect(positions[31]).toEqual({ x: 73, y: 16 });
    expect(positions[32]).toEqual({ x: 128, y: 16 });
  });

  it("shifts a little more on each further pass", () => {
    const { positions, overflow } = placeAutoCells(61, [], A4.w, A4.h);

    expect(overflow).toBe(31);
    expect(positions[60]).toEqual({ x: 26, y: 22 }); // 3 回目の走査: 16 mm, 12 mm
  });

  it("fits 80 cells on A2 landscape without overlap or overflow (the warning's advice works)", () => {
    const { positions, overflow } = placeAutoCells(80, [], 574, 400);

    expect(overflow).toBe(0);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(overlaps(rect(positions[i]!), rect(positions[j]!))).toBe(false);
      }
    }
  });

  it("never puts a cell outside the paper, however many there are", () => {
    const { positions } = placeAutoCells(200, [], A4.w, A4.h);

    expect(positions).toHaveLength(200);
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + CELL_W).toBeLessThanOrEqual(A4.w);
      expect(p.y + CELL_H).toBeLessThanOrEqual(A4.h);
    }
  });
});

const HEAD = "signature sX { void run(void); };\ncelltype tT { call sX c; };\n";

describe("auto placement on load", () => {
  it("keeps cells that have a saved layout where they are, and places the others around them", () => {
    const text = `${HEAD}cell tT saved {};\ncell tT free1 {};\ncell tT free2 {};\n` +
      `__tool_info__("tecscde") {"cell_list":{"saved":{"location":[10,10,25,15],"region":"::"}},"join_list":{}}\n`;

    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(text, "main.cde");

    expect(doc.getCell(asCellId("saved"))).toMatchObject({ x: 10, y: 10 });
    expect(doc.getCell(asCellId("free1"))).toMatchObject({ x: 65, y: 10 }); // (10, 10) は保存済みのセルが使っている
    expect(doc.getCell(asCellId("free2"))).toMatchObject({ x: 120, y: 10 });
    expect(diagnostics.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW")).toEqual([]);
  });

  it("reports how many cells did not fit on the paper written in the file", () => {
    const names = Array.from({ length: 34 }, (_, i) => `c${i}`);
    // 用紙の指定がなければ、収まる用紙が選ばれる（auto-paper.test.ts）。指定があるときだけ、収まらずに警告する。
    const text = HEAD + names.map((n) => `cell tT ${n} {};`).join("\n") + "\n" +
      `__tool_info__("tecscde") {"paper":{"size":"A4","orientation":"LANDSCAPE"},"cell_list":{},"join_list":{}}\n`;

    const { diagnostics } = CdlDocumentLoader.loadSingle(text, "main.cde");

    const warnings = diagnostics.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe("warning");
    expect(warnings[0]!.message).toContain("4 個");
    expect(warnings[0]!.message).toContain("用紙");
  });
});

// 外部仕様7.3.2 — 結合の自動経路生成で、他セルの矩形と重ならない候補を優先する。
// 既存の水平・垂直の折れ線パターンの範囲内（L字・コの字）で候補を選び、すべての交差を除去する保証はしない。

import { describe, expect, it } from "vitest";
import { autoRouteBars, type RectMm } from "../../src/renderer/model/geometry";
import type { Bar } from "../../src/renderer/model/join";

/** 経路の連続性（各バーの終点が次のバーの始点）と、始点・終点が指定の点であることを確かめる。 */
function expectContinuous(bars: readonly Bar[], from: { x: number; y: number }, to: { x: number; y: number }): void {
  const point = (b: Bar, atStart: boolean): { x: number; y: number } => {
    const v = atStart ? b.from : b.to;
    return b.direction === "H" ? { x: v, y: b.fixed } : { x: b.fixed, y: v };
  };
  expect(point(bars[0]!, true)).toEqual(from);
  for (let i = 0; i + 1 < bars.length; i += 1) {
    expect(point(bars[i]!, false)).toEqual(point(bars[i + 1]!, true));
  }
  expect(point(bars[bars.length - 1]!, false)).toEqual(to);
}

/** 経路のうちポート直後の区間（先頭・末尾のバー）を除いた部分が、矩形の内部を横切るか。 */
function crossesInterior(bars: readonly Bar[], rect: RectMm): boolean {
  return bars.slice(1, -1).some((b) => {
    const lo = Math.min(b.from, b.to);
    const hi = Math.max(b.from, b.to);
    if (b.direction === "H") {
      return b.fixed > rect.y && b.fixed < rect.y + rect.height && hi > rect.x && lo < rect.x + rect.width;
    }
    return b.fixed > rect.x && b.fixed < rect.x + rect.width && hi > rect.y && lo < rect.y + rect.height;
  });
}

const FROM = { x: 0, y: 0 };
const TO = { x: 20, y: 10 };

describe("autoRouteBars — 障害物の回避（外部仕様7.3.2）", () => {
  it("keeps the original L-shaped route when nothing is in the way", () => {
    const bars = autoRouteBars(FROM, "RIGHT", TO, "LEFT");
    expect(bars).toEqual([
      { direction: "H", fixed: 0, from: 0, to: 4 },
      { direction: "H", fixed: 0, from: 4, to: 16 },
      { direction: "V", fixed: 16, from: 0, to: 10 },
      { direction: "H", fixed: 10, from: 16, to: 20 },
    ]);
    expect(autoRouteBars(FROM, "RIGHT", TO, "LEFT", [])).toEqual(bars);
  });

  it("keeps the original route when the obstacles are elsewhere", () => {
    const away: RectMm = { x: 100, y: 100, width: 10, height: 10 };
    expect(autoRouteBars(FROM, "RIGHT", TO, "LEFT", [away])).toEqual(autoRouteBars(FROM, "RIGHT", TO, "LEFT"));
  });

  it("switches to the other L-shaped route when the original crosses a cell", () => {
    const blocker: RectMm = { x: 8, y: -2, width: 4, height: 4 }; // 元の水平区間 y=0 をふさぐ
    const bars = autoRouteBars(FROM, "RIGHT", TO, "LEFT", [blocker]);
    expectContinuous(bars, FROM, TO);
    expect(crossesInterior(bars, blocker)).toBe(false);
  });

  it("detours (コの字) when both L-shaped routes are blocked", () => {
    const a: RectMm = { x: 8, y: -2, width: 4, height: 4 }; // 元のL: 水平 y=0
    const b: RectMm = { x: 2, y: 4, width: 4, height: 4 }; // もう一方のL: 垂直 x=4
    const bars = autoRouteBars(FROM, "RIGHT", TO, "LEFT", [a, b]);
    expectContinuous(bars, FROM, TO);
    expect(crossesInterior(bars, a)).toBe(false);
    expect(crossesInterior(bars, b)).toBe(false);
  });

  it("is deterministic and axis-aligned (no diagonal bars)", () => {
    const blocker: RectMm = { x: 8, y: -2, width: 4, height: 4 };
    const first = autoRouteBars(FROM, "RIGHT", TO, "LEFT", [blocker]);
    expect(autoRouteBars(FROM, "RIGHT", TO, "LEFT", [blocker])).toEqual(first);
    for (const b of first) expect(["H", "V"]).toContain(b.direction);
  });

  it("falls back to the original route when no candidate does better", () => {
    // 全体を覆う矩形: どの候補も同じ数だけ交差する → 元の経路を返す（経路が不必要に変わらない）。
    const wall: RectMm = { x: -100, y: -100, width: 300, height: 300 };
    expect(autoRouteBars(FROM, "RIGHT", TO, "LEFT", [wall])).toEqual(autoRouteBars(FROM, "RIGHT", TO, "LEFT"));
  });
});

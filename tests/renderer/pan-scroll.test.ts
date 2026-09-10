// [[TECSCDE-DT-EL内部仕様]] 第6章6.1節の逸脱 — `panCenter`(mm) ⇔ スクロール位置(px) の
// 純関数ペア。view-state.ts が「シェルがこの対応づけを持つ」としている部分の単体テスト。

import { describe, expect, it } from "vitest";
import { MM_TO_PX } from "../../src/renderer/render/view";
import { panCenterFromScroll, scrollForPanCenter } from "../../src/renderer/app/pan-scroll";

const k = MM_TO_PX; // zoom 100%

// A4 横のコンテンツ領域は 277mm×190mm。ビューポートより十分小さい倍率で試す。
const content = { width: 277 * k, height: 190 * k };
const viewport = { width: 400, height: 300 };

describe("pan-scroll", () => {
  it("round-trips panCenter → scroll → panCenter inside the scrollable range", () => {
    const panCenter = { x: 140, y: 100 };
    const scroll = scrollForPanCenter(k, panCenter, viewport, content);
    const back = panCenterFromScroll(k, scroll, viewport);
    expect(back.x).toBeCloseTo(panCenter.x, 6);
    expect(back.y).toBeCloseTo(panCenter.y, 6);
  });

  it("clamps scroll to the left/top edge when panCenter is near the origin", () => {
    const scroll = scrollForPanCenter(k, { x: 0, y: 0 }, viewport, content);
    expect(scroll.left).toBe(0);
    expect(scroll.top).toBe(0);
  });

  it("clamps scroll to the far edge when panCenter is past the content", () => {
    const scroll = scrollForPanCenter(k, { x: 10_000, y: 10_000 }, viewport, content);
    expect(scroll.left).toBe(content.width - viewport.width);
    expect(scroll.top).toBe(content.height - viewport.height);
  });

  it("returns 0 scroll when the content fits entirely in the viewport", () => {
    const bigViewport = { width: content.width + 200, height: content.height + 200 };
    const scroll = scrollForPanCenter(k, { x: 140, y: 95 }, bigViewport, content);
    expect(scroll).toEqual({ left: 0, top: 0 });
  });

  it("scales with zoom (2x zoom doubles the pixel offset for the same panCenter)", () => {
    const at1x = scrollForPanCenter(k, { x: 140, y: 100 }, viewport, content);
    const at2x = scrollForPanCenter(k * 2, { x: 140, y: 100 }, viewport, {
      width: content.width * 2,
      height: content.height * 2,
    });
    expect(at2x.left).toBeCloseTo(140 * k * 2 - viewport.width / 2, 6);
    expect(at2x.left).toBeGreaterThan(at1x.left);
  });
});

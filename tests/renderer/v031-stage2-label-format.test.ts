import { describe, expect, it } from "vitest";
import {
  displayWidth,
  shortenCellName,
  formatCellDisplayLabel,
  formatCelltypeDisplayLabel,
} from "../../src/renderer/render/label-format";

describe("V0.3.1 Stage 2: label formatting (pure functions)", () => {
  it("computes display width with half-width=1 and full-width=2", () => {
    expect(displayWidth("")).toBe(0);
    expect(displayWidth("abc123")).toBe(6);
    expect(displayWidth("abcdefg")).toBe(7);
    expect(displayWidth("あいう")).toBe(6);
    expect(displayWidth("あいうえ")).toBe(8);
    expect(displayWidth("abあい")).toBe(6);
    expect(displayWidth("abcあい")).toBe(7);
  });

  it("keeps cell names of display width <= 6 unchanged and shortens width >= 7 to first2 + '--' + last2", () => {
    expect(shortenCellName("")).toBe("");
    expect(shortenCellName("c1")).toBe("c1");
    expect(shortenCellName("abcdef")).toBe("abcdef"); // 6 half-width
    expect(shortenCellName("abcdefg")).toBe("ab--fg"); // 7 half-width
    expect(shortenCellName("MyLongCellName")).toBe("My--me");
    expect(shortenCellName("あいう")).toBe("あいう"); // 3 full-width = width 6
    expect(shortenCellName("あいうえ")).toBe("あい--うえ"); // 4 full-width = width 8
    expect(shortenCellName("あいうえお")).toBe("あい--えお"); // 5 full-width = width 10
    expect(shortenCellName("abあい")).toBe("abあい"); // width 6
    expect(shortenCellName("abcあい")).toBe("ab--あい"); // width 7
  });

  it("formats cell display labels with show/shorten/hide and namespace show/dot", () => {
    expect(formatCellDisplayLabel("MyLongCell", "show", "show")).toBe("MyLongCell");
    expect(formatCellDisplayLabel("MyLongCell", "shorten", "show")).toBe("My--ll");
    expect(formatCellDisplayLabel("MyLongCell", "hide", "show")).toBeNull();
    // 名前空間なしセルは namespaceDisplay="dot" でも変わらない
    expect(formatCellDisplayLabel("MyLongCell", "show", "dot")).toBe("MyLongCell");
    expect(formatCellDisplayLabel("c1", "show", "dot")).toBe("c1");

    // 名前空間ありセルは namespaceDisplay="dot" で名前空間部分を ● に置換
    expect(formatCellDisplayLabel("nMruby::MyLongCell", "show", "show")).toBe("nMruby::MyLongCell");
    expect(formatCellDisplayLabel("nMruby::MyLongCell", "show", "dot")).toBe("●::MyLongCell");
    expect(formatCellDisplayLabel("nMruby::MyLongCell", "shorten", "show")).toBe("nMruby::My--ll");
    expect(formatCellDisplayLabel("nMruby::MyLongCell", "shorten", "dot")).toBe("●::My--ll");
    expect(formatCellDisplayLabel("::nA::nB::c1", "show", "dot")).toBe("●::c1");
    expect(formatCellDisplayLabel("nMruby::MyLongCell", "hide", "dot")).toBeNull();
  });

  it("formats celltype display labels with namespace show/dot only when namespace is present", () => {
    expect(formatCelltypeDisplayLabel("tTask", "show")).toBe("tTask");
    expect(formatCelltypeDisplayLabel("tTask", "dot")).toBe("tTask");
    expect(formatCelltypeDisplayLabel("nMruby::tBridge", "show")).toBe("nMruby::tBridge");
    expect(formatCelltypeDisplayLabel("nMruby::tBridge", "dot")).toBe("●::tBridge");
    expect(formatCelltypeDisplayLabel("::nA::nB::tLeaf", "dot")).toBe("●::tLeaf");
  });
});

import { describe, expect, it } from "vitest";
import { chooseAutoPaperSize } from "../../src/renderer/cdl/auto-placement";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

// 外部仕様5.3.x（2026-11-03）: ファイルに用紙の指定がないときは、自動配置したセルがすべて収まる最小の用紙
// （A4横 → A3横 → A2横）を選ぶ。用紙の指定があるときは、その用紙を尊重する。向きは横だけ。
describe("chooseAutoPaperSize", () => {
  it("picks the smallest landscape paper where every cell fits without overflow", () => {
    expect(chooseAutoPaperSize(0, [])).toBe("A4");
    expect(chooseAutoPaperSize(30, [])).toBe("A4"); // A4横は5列 x 6段 = 30個
    expect(chooseAutoPaperSize(31, [])).toBe("A3");
    expect(chooseAutoPaperSize(63, [])).toBe("A3"); // A3横は7列 x 9段 = 63個
    expect(chooseAutoPaperSize(64, [])).toBe("A2");
    expect(chooseAutoPaperSize(80, [])).toBe("A2");
  });

  it("falls back to A2 when even A2 cannot hold every cell", () => {
    expect(chooseAutoPaperSize(500, [])).toBe("A2");
  });

  it("needs a paper that also contains the cells that already have a position", () => {
    const farRight = [{ x: 300, y: 10, width: 25, height: 15 }]; // A4横 (277 mm) の外
    expect(chooseAutoPaperSize(1, farRight)).toBe("A3");
    const farBottom = [{ x: 10, y: 250, width: 25, height: 15 }]; // A3横 (277 mm) の内、A4横 (190 mm) の外
    expect(chooseAutoPaperSize(1, farBottom)).toBe("A3");
  });
});

const HEAD = "signature sX { void run(void); };\ncelltype tT { call sX c; };\n";
const cells = (n: number): string => Array.from({ length: n }, (_, i) => `cell tT c${i} {};`).join("\n") + "\n";
const paperBlock = (size: string): string =>
  `__tool_info__("tecscde") {"paper":{"size":"${size}","orientation":"LANDSCAPE"},"cell_list":{},"join_list":{}}\n`;

describe("paper on load", () => {
  it("keeps A4 landscape for a small file without a paper", () => {
    const { document: doc } = CdlDocumentLoader.loadSingle(HEAD + cells(5), "main.cde");

    expect(doc.paper.size).toBe("A4");
    expect(doc.paper.orientation).toBe("LANDSCAPE");
  });

  it("selects a larger paper when the cells do not fit A4, so no overflow warning is needed", () => {
    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(HEAD + cells(40), "main.cde");

    expect(doc.paper.size).toBe("A3");
    expect(doc.paper.orientation).toBe("LANDSCAPE");
    expect(diagnostics.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW")).toEqual([]);
  });

  it("selects A2 for 80 cells", () => {
    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(HEAD + cells(80), "main.cde");

    expect(doc.paper.size).toBe("A2");
    expect(diagnostics.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW")).toEqual([]);
  });

  it("respects a paper written in the file, and warns when the cells do not fit", () => {
    const { document: doc, diagnostics } = CdlDocumentLoader.loadSingle(HEAD + cells(40) + paperBlock("A4"), "main.cde");

    expect(doc.paper.size).toBe("A4");
    const warnings = diagnostics.filter((d) => d.code === "W-AUTO-LAYOUT-OVERFLOW");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("10 個");
  });
});

import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { asCellId } from "../../src/renderer/model/ids";

// 監査#23: 配列の呼び口を要素へ展開し、添字付きの結合を解決する。
const SOURCE = `
signature sX { void run(void); };
celltype tA { call sX cFixed[3]; call sX cVar[]; call sX cPlain; };
celltype tT { entry sX e; };
cell tT t1 {};
cell tA a1 { cFixed[0] = t1.e; cFixed[2] = t1.e; cVar[1] = t1.e; cPlain = t1.e; };
`;

function load() {
  const r = CdlDocumentLoader.loadSingle(SOURCE, "main.cde");
  return { doc: r.document, diagnostics: r.diagnostics, cell: r.document.getCell(asCellId("a1"))! };
}

describe("array call ports on load (#23)", () => {
  it("expands a fixed-length array into N elements that keep the declared size", () => {
    const { cell } = load();
    const elements = cell.cports.filter((p) => p.name === "cFixed");
    expect(elements.map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(elements.every((p) => p.arraySize === 3)).toBe(true);
  });

  it("expands a variable-length array to the highest joined index + 1 with no declared size", () => {
    const { cell } = load();
    const elements = cell.cports.filter((p) => p.name === "cVar");
    expect(elements.map((p) => p.subscript)).toEqual([0, 1]);
    expect(elements.every((p) => p.arraySize === null)).toBe(true);
  });

  it("leaves a non-array port as one element and resolves subscripted joins", () => {
    const { cell, diagnostics } = load();
    expect(cell.cports.filter((p) => p.name === "cPlain").map((p) => p.subscript)).toEqual([null]);
    expect(cell.findCPort("cFixed", 0)?.joinId).not.toBeNull();
    expect(cell.findCPort("cFixed", 1)?.joinId).toBeNull();
    expect(cell.findCPort("cFixed", 2)?.joinId).not.toBeNull();
    expect(cell.findCPort("cVar", 1)?.joinId).not.toBeNull();
    expect(diagnostics.filter((d) => d.message.includes("結合先のセルが見つかりません"))).toEqual([]);
  });

  it("round-trips subscripted joins and the per-element layout through save and reload", () => {
    const { doc } = load();
    const saved = CdlSerializer.serialize(doc);
    expect(saved).toContain("cFixed[2] = t1.e;");
    expect(saved).toContain("cVar[1] = t1.e;");
    const reloaded = CdlDocumentLoader.loadSingle(saved, "main.cde").document.getCell(asCellId("a1"))!;
    expect(reloaded.cports.map((p) => [p.name, p.subscript, p.offset])).toEqual(
      doc.getCell(asCellId("a1"))!.cports.map((p) => [p.name, p.subscript, p.offset]),
    );
  });
});

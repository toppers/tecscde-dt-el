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

describe("array length and subscript expressions (#24)", () => {
  const sizes = (text: string) => {
    const r = CdlDocumentLoader.loadSingle(
      `signature sX { void run(void); };\ncelltype tA { ${text} };\ncell tA a1 {};\n`,
      "main.cde",
    );
    return { cell: r.document.getCell(asCellId("a1"))!, diagnostics: r.diagnostics };
  };

  it("evaluates integer constant expressions in the array length", () => {
    expect(sizes("call sX c[2 + 1];").cell.cports.map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(sizes("call sX c[(1 + 1) * 2];").cell.cports).toHaveLength(4);
    expect(sizes("call sX c[0x3];").cell.cports).toHaveLength(3);
    expect(sizes("call sX c[7 / 2];").cell.cports).toHaveLength(3);
  });

  it("keeps an unevaluable length as one port and warns instead of guessing a variable-length array", () => {
    const { cell, diagnostics } = sizes("call sX c[N_MAX];");
    expect(cell.cports.map((p) => p.subscript)).toEqual([null]);
    expect(diagnostics.some((d) => d.code === "W-ARRAY-SIZE-UNRESOLVED" && d.message.includes("N_MAX"))).toBe(true);
  });

  it("treats a zero or negative length as unevaluable", () => {
    expect(sizes("call sX c[0];").diagnostics.some((d) => d.code === "W-ARRAY-SIZE-UNRESOLVED")).toBe(true);
    expect(sizes("call sX c[1 - 3];").cell.cports).toHaveLength(1);
  });

  it("resolves a join subscript written as an expression", () => {
    const r = CdlDocumentLoader.loadSingle(
      "signature sX { void run(void); };\ncelltype tA { call sX c[]; };\ncelltype tT { entry sX e; };\ncell tT t1 {};\ncell tA a1 { c[1 + 1] = t1.e; };\n",
      "main.cde",
    );
    const cell = r.document.getCell(asCellId("a1"))!;
    expect(cell.cports.map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(cell.findCPort("c", 2)?.joinId).not.toBeNull();
  });
});

describe("fixed-length entry array ports (#20, #24)", () => {
  it("expands a fixed-length entry array to declared size and connects subscripted joins", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX eFixed[3]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s1 { c = target.eFixed[2]; };
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    expect(r.diagnostics.filter((d) => d.code === "W-MISSING-JOIN-TARGET")).toEqual([]);
    const target = r.document.getCell(asCellId("target"))!;
    const elements = target.eports.filter((p) => p.name === "eFixed");
    expect(elements.map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(elements.every((p) => p.arraySize === 3)).toBe(true);

    const s1 = r.document.getCell(asCellId("s1"))!;
    const joinId = s1.findCPort("c")?.joinId;
    expect(joinId).not.toBeNull();
    const join = r.document.getJoin(joinId!)!;
    expect(join.eportSubscript).toBe(2);
    expect(target.findEPort("eFixed", 2)?.joinIds).toContain(joinId);
  });

  it("reports W-MISSING-JOIN-TARGET on out-of-range subscript and preserves it as unresolved on save", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX eFixed[3]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s1 { c = target.eFixed[3]; };
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    expect(r.diagnostics.some((d) => d.code === "W-MISSING-JOIN-TARGET")).toBe(true);
    const s1 = r.document.getCell(asCellId("s1"))!;
    expect(s1.findCPort("c")?.joinId).toBeNull();

    const saved = CdlSerializer.serialize(r.document);
    expect(saved).toContain("c = target.eFixed[3];");
  });

  it("reports W-MISSING-JOIN-TARGET when subscript is omitted on an array entry port", () => {
    const cdlOmitted = `
signature sX { void run(void); };
celltype tTarget { entry sX eFixed[3]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s1 { c = target.eFixed; };
`;
    const r1 = CdlDocumentLoader.loadSingle(cdlOmitted, "main.cde");
    expect(r1.diagnostics.some((d) => d.code === "W-MISSING-JOIN-TARGET")).toBe(true);
    expect(r1.document.getCell(asCellId("s1"))!.findCPort("c")?.joinId).toBeNull();

    const cdlEmptyBrackets = `
signature sX { void run(void); };
celltype tTarget { entry sX eFixed[3]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s2 { c = target.eFixed[]; };
`;
    const r2 = CdlDocumentLoader.loadSingle(cdlEmptyBrackets, "main.cde");
    expect(r2.diagnostics.some((d) => d.code === "W-MISSING-JOIN-TARGET")).toBe(true);
    expect(r2.document.getCell(asCellId("s2"))!.findCPort("c")?.joinId).toBeNull();
  });
});

describe("variable-length entry array ports (#20, #24)", () => {
  it("expands to highest referenced index + 1 or 1 if unreferenced", () => {
    const cdlUnref = `
signature sX { void run(void); };
celltype tTarget { entry sX eVar[]; };
cell tTarget target {};
`;
    const r1 = CdlDocumentLoader.loadSingle(cdlUnref, "main.cde");
    const target1 = r1.document.getCell(asCellId("target"))!;
    const elements1 = target1.eports.filter((p) => p.name === "eVar");
    expect(elements1.map((p) => p.subscript)).toEqual([0]);
    expect(elements1[0]?.arraySize).toBeNull();

    const cdlRef = `
signature sX { void run(void); };
celltype tTarget { entry sX eVar[]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s1 { c = target.eVar[2]; };
`;
    const r2 = CdlDocumentLoader.loadSingle(cdlRef, "main.cde");
    const target2 = r2.document.getCell(asCellId("target"))!;
    const elements2 = target2.eports.filter((p) => p.name === "eVar");
    expect(elements2.map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(elements2.every((p) => p.arraySize === null)).toBe(true);
    expect(target2.findEPort("eVar", 2)?.joinIds).toHaveLength(1);
  });

  it("resolves multi-source and multi-join connections correctly into variable-length entry array", () => {
    const srcA = {
      fileName: "sourceA.cde",
      text: `
signature sX { void run(void); };
celltype tTarget { entry sX eVar[]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource sA { c = target.eVar[0]; };
`,
      editable: true,
    };
    const srcB = {
      fileName: "sourceB.cde",
      text: `
cell tSource sB { c = target.eVar[2]; };
cell tSource sC { c = target.eVar[2]; };
`,
      editable: true,
    };
    const r = CdlDocumentLoader.loadSources([srcA, srcB], { primarySourceKey: "sourceA.cde" });
    expect(r.diagnostics.filter((d) => d.code === "W-MISSING-JOIN-TARGET")).toEqual([]);

    const target = r.document.getCell(asCellId("target"))!;
    const elements = target.eports.filter((p) => p.name === "eVar");
    expect(elements.map((p) => p.subscript)).toEqual([0, 1, 2]);

    const sA = r.document.getCell(asCellId("sA"))!;
    const sB = r.document.getCell(asCellId("sB"))!;
    const sC = r.document.getCell(asCellId("sC"))!;

    expect(target.findEPort("eVar", 0)?.joinIds).toEqual([sA.findCPort("c")?.joinId]);
    expect(target.findEPort("eVar", 1)?.joinIds).toEqual([]);
    // 複数入結合（sB と sC の両方が target.eVar[2] に結合）
    expect(target.findEPort("eVar", 2)?.joinIds).toContain(sB.findCPort("c")?.joinId);
    expect(target.findEPort("eVar", 2)?.joinIds).toContain(sC.findCPort("c")?.joinId);
    expect(target.findEPort("eVar", 2)?.joinIds).toHaveLength(2);
  });
});

describe("round-trip and array_elements (#20, #24)", () => {
  it("preserves rhs subscript and both-end subscripts through save and reload", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX e[3]; };
celltype tSource { call sX c[3]; call sX cPlain; };
cell tTarget target {};
cell tSource s1 {
  cPlain = target.e[2];
  c[1] = target.e[0];
};
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    const saved = CdlSerializer.serialize(r.document);
    expect(saved).toContain("cPlain = target.e[2];");
    expect(saved).toContain("c[1] = target.e[0];");

    const reloaded = CdlDocumentLoader.loadSingle(saved, "main.cde");
    const s1 = reloaded.document.getCell(asCellId("s1"))!;
    const joinPlain = reloaded.document.getJoin(s1.findCPort("cPlain")!.joinId!)!;
    expect(joinPlain.cportSubscript).toBeNull();
    expect(joinPlain.eportSubscript).toBe(2);

    const joinC1 = reloaded.document.getJoin(s1.findCPort("c", 1)!.joinId!)!;
    expect(joinC1.cportSubscript).toBe(1);
    expect(joinC1.eportSubscript).toBe(0);
  });

  it("applies per-element layout e[i] and falls back to legacy e layout", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX e[3]; };
cell tTarget target {};
__tool_info__("tecscde") {
  "cell_list": {
    "target": {
      "location": [10, 10, 40, 40],
      "ports": {
        "e": { "edge": "RIGHT", "offset": 20 },
        "e[1]": { "edge": "TOP", "offset": 30 }
      }
    }
  }
}
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    const target = r.document.getCell(asCellId("target"))!;
    const e0 = target.findEPort("e", 0)!;
    const e1 = target.findEPort("e", 1)!;
    const e2 = target.findEPort("e", 2)!;

    // e[0] は個別指定がないので旧形式 "e" からフォールバック (RIGHT, 20)
    expect(e0.edgeSide).toBe("RIGHT");
    expect(e0.offset).toBe(20);
    // e[1] は個別指定 "e[1]" が適用される (TOP, 30)
    expect(e1.edgeSide).toBe("TOP");
    expect(e1.offset).toBe(30);
    // e[2] は個別指定がないので旧形式 "e" からフォールバック (RIGHT, 20)
    expect(e2.edgeSide).toBe("RIGHT");
    expect(e2.offset).toBe(20);
  });

  it("restores unjoined tail elements via array_elements and saves them back", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX eVar[]; };
celltype tSource { call sX c; };
cell tTarget target {};
cell tSource s1 { c = target.eVar[0]; };
__tool_info__("tecscde") {
  "array_elements": [
    { "cell": "::target", "direction": "entry", "port": "eVar", "element_count": 3 }
  ]
}
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    const target = r.document.getCell(asCellId("target"))!;
    const elements = target.eports.filter((p) => p.name === "eVar");
    // 結合は eVar[0] のみだが、array_elements により 3 要素に展開される
    expect(elements.map((p) => p.subscript)).toEqual([0, 1, 2]);

    const saved = CdlSerializer.serialize(r.document);
    expect(saved).toContain('"array_elements"');
    expect(saved).toContain('"element_count": 3');

    const reloaded = CdlDocumentLoader.loadSingle(saved, "main.cde");
    const reloadedTarget = reloaded.document.getCell(asCellId("target"))!;
    expect(reloadedTarget.eports.filter((p) => p.name === "eVar")).toHaveLength(3);
  });

  it("discards array_elements on fixed-length array port with W-LAYOUT-DISCARDED warning", () => {
    const cdl = `
signature sX { void run(void); };
celltype tTarget { entry sX eFixed[3]; };
cell tTarget target {};
__tool_info__("tecscde") {
  "array_elements": [
    { "cell": "::target", "direction": "entry", "port": "eFixed", "element_count": 5 }
  ]
}
`;
    const r = CdlDocumentLoader.loadSingle(cdl, "main.cde");
    expect(r.diagnostics.some((d) => d.code === "W-LAYOUT-DISCARDED")).toBe(true);
    const target = r.document.getCell(asCellId("target"))!;
    const elements = target.eports.filter((p) => p.name === "eFixed");
    // 固定長は宣言サイズの 3 個のまま
    expect(elements).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { DeleteJoinCommand } from "../../src/renderer/commands/join-commands";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";

// 外部仕様 4.6.x（2026-11-02）: 配列の呼び口への結合で、添字を省く書き方 `cPort[] = c.e;`。
// 書かれた順に 0, 1, 2… を割り当てる（tecsgen の Join の添字 -1 と add_array_member に倣う）。
const HEAD = `
signature sX { void run(void); };
celltype tA { call sX cFixed[3]; call sX cVar[]; call sX cPlain; };
celltype tT { entry sX e; };
cell tT t1 {};
cell tT t2 {};
cell tT t3 {};
`;

function load(cellBody: string) {
  const r = CdlDocumentLoader.loadSingle(`${HEAD}cell tA a1 { ${cellBody} };\n`, "main.cde");
  return { doc: r.document, diagnostics: r.diagnostics, cell: r.document.getCell(asCellId("a1"))! };
}

const targetOf = (doc: ReturnType<typeof load>["doc"], cellId: string, port: string, index: number) => {
  const join = doc.getJoin(asJoinId(`${cellId}.${port}[${index}]`));
  return join ? doc.getCell(join.eportCellId)?.name : undefined;
};

/** 保存結果のうち、セル a1 の定義の中身だけ（レイアウトの tool_info には `cVar[0]` のような鍵が入るため）。 */
const cellBody = (saved: string): string => /cell tA a1 \{([\s\S]*?)\n\};/.exec(saved)?.[1] ?? "";

describe("array call port joins with an omitted subscript (spec 4.6.x)", () => {
  it("assigns 0, 1, 2… in the order written to a variable-length array, and resolves them all", () => {
    const { doc, cell, diagnostics } = load("cVar[] = t1.e; cVar[] = t2.e; cVar[] = t3.e;");

    expect(cell.cports.filter((p) => p.name === "cVar").map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((i) => targetOf(doc, "a1", "cVar", i))).toEqual(["t1", "t2", "t3"]);
    expect(diagnostics.filter((d) => d.code === "W-MISSING-JOIN-TARGET")).toEqual([]);
    expect(diagnostics.filter((d) => d.code === "W-JOIN-INDEX-INCONSISTENT")).toEqual([]);
  });

  it("assigns from 0 in a fixed-length array and leaves the rest unjoined", () => {
    const { doc, cell, diagnostics } = load("cFixed[] = t1.e; cFixed[] = t2.e;");

    expect(cell.cports.filter((p) => p.name === "cFixed").map((p) => p.subscript)).toEqual([0, 1, 2]);
    expect(targetOf(doc, "a1", "cFixed", 0)).toBe("t1");
    expect(targetOf(doc, "a1", "cFixed", 1)).toBe("t2");
    expect(cell.findCPort("cFixed", 2)?.joinId).toBeNull();
    expect(diagnostics.filter((d) => d.code === "W-MISSING-JOIN-TARGET")).toEqual([]);
  });

  it("numbers each call port separately", () => {
    const { doc } = load("cVar[] = t1.e; cFixed[] = t2.e; cVar[] = t3.e;");

    expect(targetOf(doc, "a1", "cVar", 0)).toBe("t1");
    expect(targetOf(doc, "a1", "cVar", 1)).toBe("t3");
    expect(targetOf(doc, "a1", "cFixed", 0)).toBe("t2");
  });

  it("warns once per port when subscripted and omitted joins are mixed, and keeps loading", () => {
    const { cell, diagnostics } = load("cVar[0] = t1.e; cVar[] = t2.e; cVar[] = t3.e;");

    const mixed = diagnostics.filter((d) => d.code === "W-JOIN-INDEX-INCONSISTENT");
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.severity).toBe("warning");
    expect(mixed[0]!.message).toContain("a1");
    expect(mixed[0]!.message).toContain("cVar");
    expect(cell.findCPort("cVar", 0)?.joinId).not.toBeNull();
  });

  it("writes an unchanged port back as it was read (omitted subscripts stay omitted), in order", () => {
    const { doc } = load("cVar[] = t1.e; cVar[] = t2.e;");

    const saved = CdlSerializer.serialize(doc);
    const body = cellBody(saved);

    expect(body).not.toMatch(/cVar\[\d+\]/);
    expect(body.indexOf("cVar[] = t1.e;")).toBeGreaterThan(-1);
    expect(body.indexOf("cVar[] = t1.e;")).toBeLessThan(body.indexOf("cVar[] = t2.e;"));
    const reloaded = CdlDocumentLoader.loadSingle(saved, "main.cde");
    expect(targetOf(reloaded.document, "a1", "cVar", 0)).toBe("t1");
    expect(targetOf(reloaded.document, "a1", "cVar", 1)).toBe("t2");
    expect(reloaded.diagnostics.filter((d) => d.code === "W-MISSING-JOIN-TARGET")).toEqual([]);
  });

  it("writes every element with its subscript once a join of that port is deleted", () => {
    const { doc } = load("cVar[] = t1.e; cVar[] = t2.e; cVar[] = t3.e;");

    const changed = new DeleteJoinCommand(asJoinId("a1.cVar[0]")).apply(doc);
    const body = cellBody(CdlSerializer.serialize(changed));

    expect(body).not.toContain("cVar[] =");
    expect(body).toContain("cVar[1] = t2.e;");
    expect(body).toContain("cVar[2] = t3.e;");
    expect(body).not.toContain("cVar[0]");
  });

  it("keeps writing a port that was written with subscripts with subscripts", () => {
    const { doc } = load("cVar[0] = t1.e; cVar[1] = t2.e;");

    const saved = CdlSerializer.serialize(doc);

    expect(saved).toContain("cVar[0] = t1.e;");
    expect(saved).toContain("cVar[1] = t2.e;");
  });
});

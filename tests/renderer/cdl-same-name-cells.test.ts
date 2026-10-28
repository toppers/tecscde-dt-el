import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { RenameCellCommand } from "../../src/renderer/commands";
import { asCellId } from "../../src/renderer/model/ids";

// 監査#25: 異なる namespace の同名セルを共存させる。衝突したセルのIDは修飾名（`::N::c1`）、衝突しないセルは名前のまま。
const HEAD = `signature sX { void run(void); };
celltype tT { entry sX e; };
celltype tA { call sX c; };
`;

const TWO_NAMESPACES = `
namespace N { cell tT t1 {}; cell tA a1 { c = t1.e; }; };
namespace M { cell tT t1 {}; cell tA a2 { c = t1.e; }; };
cell tT solo {};
`;

function load(body: string) {
  const r = CdlDocumentLoader.loadSingle(HEAD + body, "main.cde");
  return { doc: r.document, diagnostics: r.diagnostics };
}

describe("same-named cells in different namespaces (#25)", () => {
  it("keeps both cells, qualifies only the colliding ids, and warns about no duplicate", () => {
    const { doc, diagnostics } = load(TWO_NAMESPACES);
    expect(doc.cellValues().map((c) => c.id).sort()).toEqual(["::M::t1", "::N::t1", "a1", "a2", "solo"]);
    expect(doc.getCell(asCellId("::N::t1"))?.name).toBe("t1");
    expect(doc.getCell(asCellId("::M::t1"))?.name).toBe("t1");
    expect(diagnostics.filter((d) => d.code === "W-DUP-CELL")).toEqual([]);
  });

  it("resolves an unqualified join target from the caller's own namespace", () => {
    const { doc } = load(TWO_NAMESPACES);
    const joinOf = (cellId: string) => doc.getJoin(doc.getCell(asCellId(cellId))!.findCPort("c")!.joinId!);
    expect(joinOf("a1")?.eportCellId).toBe(asCellId("::N::t1"));
    expect(joinOf("a2")?.eportCellId).toBe(asCellId("::M::t1"));
  });

  it("still reports a duplicate for the same name in the same namespace", () => {
    const { doc, diagnostics } = load("namespace N { cell tT t1 {}; cell tT t1 {}; };\n");
    expect(doc.cellCount).toBe(1);
    expect(diagnostics.filter((d) => d.code === "W-DUP-CELL")).toHaveLength(1);
  });

  it("round-trips through save: both cells and both joins survive in their own namespaces", () => {
    const { doc } = load(TWO_NAMESPACES);
    const saved = CdlSerializer.serialize(doc);
    const reloaded = load(saved);
    expect(reloaded.doc.cellValues().map((c) => c.id).sort()).toEqual(["::M::t1", "::N::t1", "a1", "a2", "solo"]);
    const joinOf = (cellId: string) =>
      reloaded.doc.getJoin(reloaded.doc.getCell(asCellId(cellId))!.findCPort("c")!.joinId!);
    expect(joinOf("a1")?.eportCellId).toBe(asCellId("::N::t1"));
    expect(joinOf("a2")?.eportCellId).toBe(asCellId("::M::t1"));
  });

  it("writes a fully qualified target when a join crosses into another namespace's colliding cell", () => {
    const { doc } = load(
      "namespace N { cell tT t1 {}; };\nnamespace M { cell tT t1 {}; };\ncell tA a1 { c = ::M::t1.e; };\n",
    );
    const saved = CdlSerializer.serialize(doc);
    expect(saved).toContain("c = ::M::t1.e;");
  });

  it("keeps the namespace in the written target after the colliding cell is renamed", () => {
    const { doc } = load(
      "namespace N { cell tT t1 {}; };\nnamespace M { cell tT t1 {}; };\ncell tA a1 { c = ::M::t1.e; };\n",
    );
    const renamed = new RenameCellCommand(asCellId("::M::t1"), "t9").apply(doc);
    expect(renamed.getCell(asCellId("::M::t1"))?.name).toBe("t9");
    expect(CdlSerializer.serialize(renamed)).toContain("c = ::M::t9.e;");
  });
});

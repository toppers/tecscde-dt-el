import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { asCellId } from "../../src/renderer/model/ids";

// 監査#26: namespace 修飾付きの結合先（`N::cell.e`、`::N::cell.e`）を解決する。
const HEAD = `signature sX { void run(void); };
celltype tT { entry sX e; };
celltype tA { call sX c; };
`;

function load(body: string) {
  const r = CdlDocumentLoader.loadSingle(HEAD + body, "main.cde");
  const missing = r.diagnostics.filter((d) => d.message.includes("結合先"));
  return { doc: r.document, missing };
}

describe("namespace-qualified join targets (#26)", () => {
  const TARGET = "namespace N { cell tT t1 {}; };\ncell tA a1 { c = N::t1.e; };\n";

  it("resolves a relative qualified target to the cell in that namespace", () => {
    const { doc, missing } = load(TARGET);
    expect(missing).toEqual([]);
    const join = doc.getJoin(doc.getCell(asCellId("a1"))!.findCPort("c")!.joinId!);
    expect(join?.eportCellId).toBe(asCellId("t1"));
  });

  it("resolves an absolute target and rejects one whose namespace does not match", () => {
    expect(load("namespace N { cell tT t1 {}; };\ncell tA a1 { c = ::N::t1.e; };\n").missing).toEqual([]);
    expect(load("namespace N { cell tT t1 {}; };\ncell tA a1 { c = ::M::t1.e; };\n").missing).toHaveLength(1);
    expect(load("namespace N { cell tT t1 {}; };\ncell tA a1 { c = M::t1.e; };\n").missing).toHaveLength(1);
  });

  it("matches nested namespaces and ignores region names in the qualification", () => {
    const body = "namespace N { namespace M { region R { cell tT t1 {}; }; }; };\ncell tA a1 { c = N::M::t1.e; };\n";
    expect(load(body).missing).toEqual([]);
  });

  it("keeps resolving an unqualified name as before", () => {
    expect(load("cell tT t1 {};\ncell tA a1 { c = t1.e; };\n").missing).toEqual([]);
  });

  it("writes the qualified target back when saving, so the CDL stays valid", () => {
    const { doc } = load(TARGET);
    const saved = CdlSerializer.serialize(doc);
    expect(saved).toContain("c = N::t1.e;");
    expect(load(saved).missing).toEqual([]);
  });
});

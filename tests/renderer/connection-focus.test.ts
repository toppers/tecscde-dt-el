import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { SelectionState } from "../../src/renderer/render/view";
import { asCellId } from "../../src/renderer/model/ids";
import { resolveHighlightedJoinIds } from "../../src/renderer/render/connection-focus";

describe("port connection focus", () => {
  it("selects only directly connected joins and keeps port selection outside history", () => {
    const doc = CdlDocumentLoader.loadSingle('signature s { void f(void); };\ncelltype t { call s c; entry s e; };\ncell t A { c = B.e; };\ncell t B {};\n', "main.cdl").document;
    const selection = SelectionState.ofPorts([{ cellId: asCellId("B"), kind: "eport", name: "e", subscript: null }]);
    expect(selection.isEmpty).toBe(false);
    expect([...resolveHighlightedJoinIds(doc, selection.ports)].map(String)).toEqual(["A.c"]);
    expect(resolveHighlightedJoinIds(doc, []).size).toBe(0);
  });
});

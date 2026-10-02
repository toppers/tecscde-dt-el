import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { asCellId } from "../../src/renderer/model/ids";

const source = `namespace nDemo {
  composite tComposite {
    entry sTask eTask;
    [optional] call sTask cTask;
    attr { int value; };
    cell tInner Inner {};
  };
};
cell nDemo::tComposite Composite {
  value = 3;
};
`;

describe("composite celltype interface", () => {
  it("resolves a top-level composite declaration", () => {
    const text = `composite tDirect {
  entry sTask eTask;
};
cell tDirect Direct {};
`;
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text, fileName: "direct.cdl", editable: true },
    ]);
    expect(document.getCelltype("tDirect")?.eportTemplates[0]?.name).toBe("eTask");
    expect(document.getCell(asCellId("Direct"))?.celltypeUnresolved).toBe(false);
    expect(diagnostics.filter((item) => item.code === W_CODES.COMPOSITE_UNSUPPORTED)).toEqual([]);
  });

  it("resolves a namespaced composite as a celltype with external ports and attributes", () => {
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: source, fileName: "composite.cdl", editable: true },
    ]);

    const celltype = document.getCelltype("nDemo::tComposite");
    const cell = document.getCell(asCellId("Composite"));
    expect(celltype?.cportTemplates.map((port) => port.name)).toEqual(["cTask"]);
    expect(celltype?.eportTemplates.map((port) => port.name)).toEqual(["eTask"]);
    expect(celltype?.attributeNames).toContain("value");
    expect(cell?.celltypeUnresolved).toBe(false);
    expect(cell?.cports.map((port) => port.name)).toEqual(["cTask"]);
    expect(cell?.eports.map((port) => port.name)).toEqual(["eTask"]);
    expect(document.cellCount).toBe(1);
    expect(diagnostics.filter((item) => item.code === W_CODES.COMPOSITE_UNSUPPORTED)).toEqual([]);
    expect(diagnostics.filter((item) => item.code === W_CODES.UNRESOLVED_CELLTYPE)).toEqual([]);
  });

  it("preserves the composite body when saving without edits", () => {
    const { document } = CdlDocumentLoader.loadSources([
      { text: source, fileName: "composite.cdl", editable: true },
    ]);
    const saved = CdlSerializer.serialize(document);
    expect(saved).toContain(source.slice(0, source.indexOf("cell nDemo::tComposite")));
    const reloaded = CdlDocumentLoader.loadSources([
      { text: saved, fileName: "composite.cdl", editable: true },
    ]);
    expect(reloaded.document.getCelltype("nDemo::tComposite")?.eportTemplates[0]?.name).toBe("eTask");
  });
});

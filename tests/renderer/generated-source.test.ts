import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { asCellId } from "../../src/renderer/model/ids";

describe("Plugin-generated CDL definitions", () => {
  it("resolves namespaced types without adding generated cells or reference paths", () => {
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: "cell nPlugin::tGenerated Main {};", fileName: "main.cdl", editable: true },
      {
        text: `namespace nPlugin {
  celltype tGenerated { call sPort cPort; };
  cell tGenerated GeneratedHelper {};
};`,
        fileName: "tmp_Plugin_0.cdl",
        editable: false,
        generated: true,
      },
    ]);

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(document.getCell(asCellId("Main"))?.celltypeUnresolved).toBe(false);
    expect(document.getCell(asCellId("Main"))?.cports.map((port) => port.name)).toEqual(["cPort"]);
    expect(document.getCell(asCellId("GeneratedHelper"))).toBeUndefined();
    expect(document.referenceFiles).toEqual([]);
    const saved = CdlSerializer.serialize(document);
    expect(saved).not.toContain("celltype tGenerated");
    expect(saved).not.toContain("tmp_Plugin_0.cdl");
  });

  it("keeps equal short names from different generated namespaces distinct", () => {
    const { document } = CdlDocumentLoader.loadSources([
      { text: "cell nA::tSame A {};\ncell nB::tSame B {};", fileName: "main.cdl", editable: true },
      {
        text: `namespace nA { celltype tSame { call sA cA; }; };
namespace nB { celltype tSame { call sB cB; }; };`,
        fileName: "generated.cdl",
        editable: false,
        generated: true,
      },
    ]);
    expect(document.getCell(asCellId("A"))?.cports.map((port) => port.name)).toEqual(["cA"]);
    expect(document.getCell(asCellId("B"))?.cports.map((port) => port.name)).toEqual(["cB"]);
  });
});

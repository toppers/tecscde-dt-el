import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { asCellId } from "../../src/renderer/model/ids";

describe("Plugin-generated CDL definitions", () => {
  it("registers generated cells and types without adding them to saved CDL or reference paths", () => {
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
    expect(document.getCell(asCellId("GeneratedHelper"))?.celltypeName).toBe("nPlugin::tGenerated");
    expect(document.getCell(asCellId("GeneratedHelper"))?.editable).toBe(false);
    expect(document.regions.findById(document.getCell(asCellId("GeneratedHelper"))!.regionId)?.cellIds).toContain(asCellId("GeneratedHelper"));
    expect(document.referenceFiles).toEqual([]);
    const saved = CdlSerializer.serialize(document);
    expect(saved).not.toContain("celltype tGenerated");
    expect(saved).not.toContain("GeneratedHelper");
    expect(saved).not.toContain("tmp_Plugin_0.cdl");
  });

  it("resolves a source join to a generated cell and prefers its full definition over a prototype", () => {
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: `namespace nMruby {
  signature sInit { void initialize(void); };
  celltype tMruby { call sInit cInit; };
  celltype tTECSInitializer { entry sInit eInitialize; };
};
cell nMruby::tMruby Mruby { cInit = VM_TECSInitializer.eInitialize; };`, fileName: "VM1.cdl", editable: true },
      { text: "cell nMruby::tTECSInitializer VM_TECSInitializer;", fileName: "plugin:prototype.cdl", editable: false, generated: true },
      { text: "cell nMruby::tTECSInitializer VM_TECSInitializer { value = 1; };", fileName: "plugin:definition.cdl", editable: false, generated: true },
    ]);

    const generated = document.getCell(asCellId("VM_TECSInitializer"));
    expect(generated?.editable).toBe(false);
    expect(generated?.celltypeUnresolved).toBe(false);
    expect(generated?.attrs.value).toBe("1");
    expect(document.joinCount).toBe(1);
    expect(diagnostics.some((item) => item.code === "W-MISSING-JOIN-TARGET" || item.code === "W-DUP-CELL")).toBe(false);
    const saved = CdlSerializer.serialize(document);
    expect(saved).toContain("cInit = VM_TECSInitializer.eInitialize;");
    expect(saved).not.toContain("cell nMruby::tTECSInitializer VM_TECSInitializer");
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

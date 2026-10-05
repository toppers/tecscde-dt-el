import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";

const source = `signature sKernel {
  void foo(void);
};
celltype tKernel {
  entry sKernel eKernel;
};
generate(MrubyBridgePlugin, sKernel, "");
region rDomainEV3 {
  cell nMruby::tsKernel BridgeKernel {
    cTECS = HRP2Kernel.eKernel;
  };
  cell tKernel HRP2Kernel {};
};
`;

function load(text: string) {
  return CdlDocumentLoader.loadSources([{ text, fileName: "bridge.cdl", editable: true }]);
}

describe("MrubyBridgePlugin generated celltype contract", () => {
  it("resolves a later region cell and its cTECS join", () => {
    const { document, diagnostics } = load(source);
    const bridgeType = document.getCelltype("nMruby::tsKernel");
    const initializerType = document.getCelltype("nMruby::tsKernel_Initializer");
    const bridgeCell = document.getCell(asCellId("BridgeKernel"));
    const join = document.getJoin(asJoinId("BridgeKernel.cTECS"));

    expect(bridgeType?.cportTemplates.map((port) => [port.name, port.signature])).toEqual([["cTECS", "::sKernel"]]);
    expect(bridgeType?.eportTemplates).toEqual([]);
    expect(bridgeType?.attributeNames).toEqual(["VMname", "bridgeName"]);
    expect(initializerType?.eportTemplates.map((port) => [port.name, port.signature])).toEqual([
      ["eInitialize", "sInitializeTECSBridge"],
    ]);
    expect(bridgeCell?.celltypeUnresolved).toBe(false);
    expect(bridgeCell?.cports.map((port) => port.name)).toEqual(["cTECS"]);
    expect(join?.eportCellId).toBe(asCellId("HRP2Kernel"));
    expect(join?.eportName).toBe("eKernel");
    expect(diagnostics.filter((item) => item.code === W_CODES.UNRESOLVED_CELLTYPE)).toEqual([]);
  });

  it("deduplicates generation and keeps generated definitions out of saved CDL", () => {
    const duplicated = source.replace(
      'generate(MrubyBridgePlugin, sKernel, "");',
      'generate(MrubyBridgePlugin, sKernel, "");\ngenerate(MrubyBridgePlugin, sKernel, "");',
    );
    const { document } = load(duplicated);
    expect(document.celltypeCount).toBe(3);
    const saved = CdlSerializer.serialize(document);
    expect(saved.match(/generate\(MrubyBridgePlugin, sKernel, ""\);/g)).toHaveLength(2);
    expect(saved).not.toContain("celltype tsKernel {");
    expect(load(saved).document.getCell(asCellId("BridgeKernel"))?.celltypeUnresolved).toBe(false);
  });

  it("does not invent bridge types for another plugin or a missing signature", () => {
    const otherPlugin = load(source.replace("MrubyBridgePlugin", "OtherPlugin"));
    const missingSignature = load(source.replace("signature sKernel {\n  void foo(void);\n};\n", ""));
    const emptySignature = load(source.replace("  void foo(void);\n", ""));
    expect(otherPlugin.document.getCell(asCellId("BridgeKernel"))?.celltypeUnresolved).toBe(true);
    expect(missingSignature.document.getCell(asCellId("BridgeKernel"))?.celltypeUnresolved).toBe(true);
    expect(emptySignature.document.getCell(asCellId("BridgeKernel"))?.celltypeUnresolved).toBe(true);
  });

  it("uses the Ruby global signature name for a namespaced signature", () => {
    const text = `namespace nDemo {
  signature sWorker { void foo(void); };
  generate(MrubyBridgePlugin, sWorker, "");
};
cell nMruby::tnDemo_sWorker Bridge {};
`;
    const { document } = load(text);
    expect(document.getCelltype("nMruby::tnDemo_sWorker")?.cportTemplates[0]?.signature).toBe("::nDemo::sWorker");
    expect(document.getCell(asCellId("Bridge"))?.celltypeUnresolved).toBe(false);
  });
});

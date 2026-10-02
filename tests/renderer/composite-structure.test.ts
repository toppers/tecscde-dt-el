import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { RenameCellCommand } from "../../src/renderer/commands/cell-commands";
import { asCellId } from "../../src/renderer/model/ids";

const source = `namespace nDemo {
  celltype tInner {
    entry sTask eTask;
    call sTask cTask;
    attr { int value; };
  };
  composite tComposite {
    entry sTask eTask;
    call sTask cTask;
    attr { int value; };
    cell tInner Inner {
      cTask => composite.cTask;
      value = composite.value;
    };
    composite.eTask => Inner.eTask;
  };
};
cell nDemo::tComposite Outer {};
`;

function load(text: string) {
  return CdlDocumentLoader.loadSources([{ text, fileName: "composite.cdl", editable: true }]);
}

describe("composite celltype structure", () => {
  it("retains internal cells, bindings, and exported ports outside the diagram", () => {
    const { document, diagnostics } = load(source);
    const composite = document.getCelltype("nDemo::tComposite")?.composite;

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(composite?.internalCells).toHaveLength(1);
    expect(composite?.internalCells[0]?.name).toBe("Inner");
    expect(composite?.internalCells[0]?.celltypeName).toBe("tInner");
    expect(composite?.internalCells[0]?.bindings).toEqual([
      { kind: "external", name: "cTask", target: "cTask", rawText: "cTask => composite.cTask;" },
      { kind: "join", name: "value", target: "composite.value", rawText: "value = composite.value;" },
    ]);
    expect(composite?.portExports).toEqual([
      { externalPortName: "eTask", cellName: "Inner", portName: "eTask", rawText: "composite.eTask => Inner.eTask;" },
    ]);
    expect(document.cellCount).toBe(1);
  });

  it("preserves the composite definition through unchanged and outer-cell-edited saves", () => {
    for (const text of [source, source.replace(/\n/g, "\r\n")]) {
      const { document } = load(text);
      const rawDefinition = document.getCelltype("nDemo::tComposite")?.composite?.rawText;
      expect(rawDefinition).toBeDefined();
      const renamed = new RenameCellCommand(asCellId("Outer"), "Renamed").apply(document);
      expect(renamed.getCell(asCellId("Outer"))?.name).toBe("Renamed");

      for (const [next, expectedName] of [[document, "Outer"], [renamed, "Renamed"]] as const) {
        const saved = CdlSerializer.serialize(next);
        expect(saved).toContain(rawDefinition);
        const reloaded = load(saved).document;
        expect(reloaded.cellValues().some((cell) => cell.name === expectedName)).toBe(true);
        expect(reloaded.getCelltype("nDemo::tComposite")?.composite).toEqual(
          document.getCelltype("nDemo::tComposite")?.composite,
        );
      }
    }
  });
});

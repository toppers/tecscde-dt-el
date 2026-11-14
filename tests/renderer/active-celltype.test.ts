import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlDocumentBuilder } from "../../src/renderer/cdl/cst";
import { CelltypeRef } from "../../src/renderer/model/celltype";

describe("active celltype metadata", () => {
  it("retains explicit active annotations on ordinary and composite types, including namespaces", () => {
    const text = 'signature sX { void run(void); }; [active] celltype tActive { entry sX e; }; /* [active] is only a comment */ celltype tPlain { entry sX e; }; namespace N { [active] composite tComposite { entry sX e; }; };';
    const parsed = CdlDocumentBuilder.build(text);
    expect(parsed.celltypes.find((type) => type.name === "tActive")?.active).toBe(true);
    expect(parsed.celltypes.find((type) => type.name === "tPlain")?.active).toBe(false);
    expect(parsed.composites.find((type) => type.name === "N::tComposite")?.active).toBe(true);
    const doc = CdlDocumentLoader.loadSingle(text, "active.cdl").document;
    expect(doc.getCelltype("tActive")?.active).toBe(true);
    expect(doc.getCelltype("tPlain")?.active).toBe(false);
    expect(doc.getCelltype("N::tComposite")?.active).toBe(true);
  });

  it("defaults programmatically built celltypes to inactive", () => {
    expect(CelltypeRef.create({ name: "tPlain", cportTemplates: [], eportTemplates: [], attributeNames: [], hiddenRequirePortCount: 0 }).active).toBe(false);
  });
});

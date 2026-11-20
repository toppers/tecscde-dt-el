// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CelltypeRef } from "../../src/renderer/model/celltype";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { PaperSpec } from "../../src/renderer/model/paper";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import { AppStore } from "../../src/renderer/app/store";
import { PaletteView } from "../../src/renderer/app/palette";
import { groupAndSortCelltypes, shortCelltypeName } from "../../src/renderer/app/palette-order";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

function ct(name: string, namespace?: string): CelltypeRef {
  return CelltypeRef.create({
    name,
    namespace,
    cportTemplates: [],
    eportTemplates: [],
    attributeNames: [],
    hiddenRequirePortCount: 0,
  });
}

describe("V0.3.1 Stage 1: palette celltype grouping and sorting", () => {
  it("groups celltypes with no-namespace first, then namespaces ascending, and celltypes ascending within each group", () => {
    const input = [
      ct("tZeta", "nBeta"),
      ct("tBeta"),
      ct("nAlpha::tSecond"),
      ct("tAlpha"),
      ct("nAlpha::tFirst"),
      ct("tAlpha", "nBeta"),
      ct("tSub", "nAlpha::nSub"),
    ];

    const groups = groupAndSortCelltypes(input);
    expect(groups.map((g) => g.namespace)).toEqual([null, "nAlpha", "nAlpha::nSub", "nBeta"]);
    expect(groups[0]!.celltypes.map((c) => c.name)).toEqual(["tAlpha", "tBeta"]);
    expect(groups[1]!.celltypes.map((c) => c.name)).toEqual(["nAlpha::tFirst", "nAlpha::tSecond"]);
    expect(groups[2]!.celltypes.map((c) => c.name)).toEqual(["tSub"]);
    expect(groups[3]!.celltypes.map((c) => c.name)).toEqual(["tAlpha", "tZeta"]);
  });

  it("returns empty array when given no celltypes", () => {
    expect(groupAndSortCelltypes([])).toEqual([]);
  });

  it("extracts short celltype name for sorting", () => {
    expect(shortCelltypeName("tSimple")).toBe("tSimple");
    expect(shortCelltypeName("nMruby::tBridge")).toBe("tBridge");
    expect(shortCelltypeName("::nA::nB::tLeaf")).toBe("tLeaf");
  });

  it("preserves namespace on CelltypeRef when loading ordinary and composite celltypes from CDL", () => {
    const cdl = `
signature sX { void run(void); };
celltype tRootZ { entry sX e; };
celltype tRootA { entry sX e; };
namespace nBeta {
  celltype tBetaB { entry sX e; };
  celltype tBetaA { entry sX e; };
};
namespace nAlpha {
  composite tCompA {
    entry sX e;
    cell tRootA inner {};
    composite.e => inner.e;
  };
};
`;
    const { document: doc } = CdlDocumentLoader.loadSources([{ fileName: "test.cdl", text: cdl, editable: true }]);
    const groups = groupAndSortCelltypes(doc.celltypeValues());
    expect(groups.map((g) => g.namespace)).toEqual([null, "nAlpha", "nBeta"]);
    expect(groups[0]!.celltypes.map((c) => c.name)).toEqual(["tRootA", "tRootZ"]);
    expect(groups[1]!.celltypes.map((c) => c.name)).toEqual(["nAlpha::tCompA"]);
    expect(groups[2]!.celltypes.map((c) => c.name)).toEqual(["tBetaA", "tBetaB"]);
  });

  it("renders grouped and sorted celltypes in PaletteView DOM and selects the first sorted celltype", () => {
    const celltypes = new Map<string, CelltypeRef>([
      ["nBeta::tZ", ct("nBeta::tZ")],
      ["tRootB", ct("tRootB")],
      ["nAlpha::tB", ct("nAlpha::tB")],
      ["tRootA", ct("tRootA")],
      ["nAlpha::tA", ct("nAlpha::tA")],
    ]);
    const doc = TecscdeDocument.build({
      cells: new Map(),
      joins: new Map(),
      celltypes,
      toolInfoTecsgen: emptyToolInfoTecsgen(),
      paper: PaperSpec.default(),
      referenceFiles: [],
      unknownToolInfoTecscde: {},
    });

    const store = new AppStore(doc);
    const root = document.createElement("div");
    root.innerHTML =
      '<button data-mode="select"></button><button data-mode="newCell"></button><div id="palette-celltypes"></div>';
    const onDetails = vi.fn();
    const palette = new PaletteView(root, store, onDetails);
    const unsub = store.subscribe(() => palette.render());
    palette.render();

    const headers = Array.from(root.querySelectorAll<HTMLElement>(".palette-group-header")).map((el) => el.textContent);
    expect(headers).toEqual(["（名前空間なし）", "nAlpha", "nBeta"]);

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".palette-celltype"));
    expect(buttons.map((b) => b.dataset["celltype"])).toEqual([
      "tRootA",
      "tRootB",
      "nAlpha::tA",
      "nAlpha::tB",
      "nBeta::tZ",
    ]);
    expect(store.getActiveCelltypeName()).toBe("tRootA");

    buttons[2]!.click();
    expect(store.getActiveCelltypeName()).toBe("nAlpha::tA");
    expect(store.getMode()).toBe("newCell");

    const detailsButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".palette-celltype-details"));
    detailsButtons[2]!.click();
    expect(onDetails).toHaveBeenCalledWith("nAlpha::tA", detailsButtons[2]);

    unsub();
    palette.dispose();
  });
});

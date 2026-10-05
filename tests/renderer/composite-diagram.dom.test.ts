/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { CompositeDiagramView, layoutComposite } from "../../src/renderer/app/composite-diagram";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId } from "../../src/renderer/model/ids";

const source = `namespace nDemo {
  celltype tWorker {
    entry sTask eTask;
    call sTask cTask;
    attr { int value; };
  };
  composite tChild {
    entry sTask eTask;
  };
  composite tParent {
    entry sTask eOuter;
    call sTask cOuter;
    cell tWorker First {
      cTask = Second.eTask;
      cOuter => composite.cOuter;
      value = Second.value;
    };
    cell tWorker Second {};
    cell tChild Nested {};
    composite.eOuter => Second.eTask;
  };
};
cell nDemo::tParent Parent {};
`;

function load() {
  return CdlDocumentLoader.loadSources([{ text: source, fileName: "composite.cdl", editable: true }]);
}

describe("composite hierarchy diagram", () => {
  let view: CompositeDiagramView | undefined;
  afterEach(() => {
    view?.dispose();
    view = undefined;
    document.body.replaceChildren();
  });

  it("draws only cell connections and supports nested drilldown and back navigation", () => {
    const { document: model, diagnostics } = load();
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const structure = model.getCelltype("nDemo::tParent")?.composite;
    expect(structure).toBeDefined();
    const layout = layoutComposite(structure!, (name) => name === "tChild", (_type, name) => name !== "value");
    expect(layout.nodes.map((node) => node.name)).toEqual(["First", "Second", "Nested"]);
    expect(layout.links.map((link) => link.kind)).toEqual(["internal", "external", "export"]);

    view = new CompositeDiagramView(document);
    expect(view.openCell(model, asCellId("Parent"))).toBe(true);
    expect(document.querySelectorAll(".composite-node")).toHaveLength(3);
    expect(document.querySelectorAll("[data-link-kind]")).toHaveLength(3);
    expect(document.querySelector(".composite-overlay")?.hasAttribute("hidden")).toBe(false);

    document.querySelector<SVGGElement>('[data-internal-cell="Nested"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(document.querySelector(".composite-header nav")?.textContent).toContain("Parent › Nested");
    expect(document.querySelectorAll(".composite-node")).toHaveLength(0);

    document.querySelector<HTMLButtonElement>(".composite-header button")?.click();
    expect(document.querySelectorAll(".composite-node")).toHaveLength(3);
    document.querySelector<HTMLButtonElement>(".composite-header button")?.click();
    expect(view.isOpen).toBe(false);
  });
});

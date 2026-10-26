/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { SvgExporter } from "../../src/renderer/export/svg-exporter";
import { defaultCanvasView, MM_TO_PX } from "../../src/renderer/render/view";

const celltypes = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const main = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");
function loadDoc() {
  return CdlDocumentLoader.loadSources([
    { text: celltypes, fileName: "celltypes.cdl", editable: true },
    { text: main, fileName: "main.cde", editable: true },
  ]).document;
}

function parse(svg: string): SVGSVGElement {
  return new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as unknown as SVGSVGElement;
}

describe("SvgExporter", () => {
  it("exports a standalone paper-size SVG with the frame and escaped file name, without transient overlays", () => {
    const doc = loadDoc();
    const result = SvgExporter.build(doc, { ...defaultCanvasView(), zoom: 1.8, gridVisible: true }, "paper", "a&b.cde");
    const root = parse(result.svg);
    const paper = doc.paper.contentSize();

    expect(result.widthMm).toBe(paper.width + 20);
    expect(result.heightMm).toBe(paper.height + 20);
    expect(root.getAttribute("width")).toBe(`${result.widthMm}mm`);
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${result.widthMm * MM_TO_PX} ${result.heightMm * MM_TO_PX}`);
    expect(root.querySelector("title")?.textContent).toBe("a&b.cde");
    expect(result.svg).toContain("a&amp;b.cde");
    expect(root.querySelector(".export-frame")).not.toBeNull();
    expect(root.querySelector(".export-filename")?.textContent).toBe("a&b.cde");
    expect(root.querySelector("style")?.textContent).toContain(".cell-rect");
    expect(root.querySelector(".cell-rect")).not.toBeNull();
    expect(root.querySelector("#grid, #selection-overlay, #join-preview")).toBeNull();
  });

  it("fits visible content with a 5 mm margin and follows the current display settings", () => {
    const doc = loadDoc();
    const first = doc.cellValues()[0]!;
    const view = {
      ...defaultCanvasView(),
      showSignatureNames: false,
      emphasizeCellName: true,
      regionColors: new Map([[first.regionId, "#123456"]]),
    };
    const result = SvgExporter.build(doc, view, "content", "main.cde");
    const root = parse(result.svg);

    expect(result.widthMm).toBeLessThan(doc.paper.contentSize().width + 20);
    expect(result.heightMm).toBeLessThan(doc.paper.contentSize().height + 20);
    expect(root.querySelector(".export-frame, .export-filename")).toBeNull();
    expect(root.querySelector(".cell-label.emphasized")).not.toBeNull();
    expect(root.querySelector(".celltype-label, .signature-label")).toBeNull();
    expect(root.querySelector(".region-tab")?.getAttribute("fill")).toBe("#123456");
  });

  it("uses the paper area when the content range has no visible elements", () => {
    const doc = loadDoc();
    const hidden = new Set(doc.cellValues().map((cell) => cell.regionId));
    const result = SvgExporter.build(doc, { ...defaultCanvasView(), hiddenRegionIds: hidden }, "content", "untitled");
    expect(result.widthMm).toBe(doc.paper.contentSize().width + 20);
    expect(parse(result.svg).querySelector(".export-frame")).not.toBeNull();
  });
});

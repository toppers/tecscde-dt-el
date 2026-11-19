/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { computeRegionOutlines } from "../../src/renderer/render/region-outlines";
import { regionColorMap } from "../../src/renderer/view-state/region-colors";
import { CellRenderer, portSymbolPoints } from "../../src/renderer/render/cell-renderer";
import { MM_TO_PX, type CanvasView } from "../../src/renderer/render/view";
import { NavigatorView } from "../../src/renderer/app/navigator-panel";
import { AppStore } from "../../src/renderer/app/store";

describe("V0.3.0 Stage 3A — 3-1: region outlines as union of cell rectangles", () => {
  it("produces two separate outlines (8 segments) when two cells in the same region are far apart", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask { entry sSig e; };
      region rA {
        cell tTask c1 {};
        cell tTask c2 {};
      };
      __tool_info__("tecscde") {
        "paper": { "size": "A4", "orientation": "LANDSCAPE" },
        "cell_list": {
          "c1": { "location": [10, 10, 20, 15], "region": "::rA" },
          "c2": { "location": [100, 80, 20, 15], "region": "::rA" }
        }
      }
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const visible = new Set(doc.cellValues().map((c) => c.id));
    const outlines = computeRegionOutlines(doc, visible, doc.regions, regionColorMap(doc.regions));
    expect(outlines).toHaveLength(1);
    // 離れた2セルは外接1矩形(4辺)ではなく、2つの独立した矩形(8辺)になる
    expect(outlines[0]!.segments).toHaveLength(8);
  });

  it("removes internal shared edges when two cells in the same region overlap", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask { entry sSig e; };
      region rA {
        cell tTask c1 {};
        cell tTask c2 {};
      };
      __tool_info__("tecscde") {
        "paper": { "size": "A4", "orientation": "LANDSCAPE" },
        "cell_list": {
          "c1": { "location": [10, 10, 20, 15], "region": "::rA" },
          "c2": { "location": [25, 18, 20, 15], "region": "::rA" }
        }
      }
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const visible = new Set(doc.cellValues().map((c) => c.id));
    const outlines = computeRegionOutlines(doc, visible, doc.regions, regionColorMap(doc.regions));
    expect(outlines).toHaveLength(1);
    // L字型（階段状）の和集合外周は 8 辺（外接矩形の 4 辺とは異なる）
    expect(outlines[0]!.segments).toHaveLength(8);
  });
});

describe("V0.3.0 Stage 3A — 3-11: port symbol direction, mm size, and zoom scaling", () => {
  it("distinguishes call and entry ports on the same edge by triangle direction and scales with zoom", () => {
    const k1 = MM_TO_PX * 1.0;
    const k2 = MM_TO_PX * 2.0;

    const cRight1 = portSymbolPoints("RIGHT", "cport", k1);
    const eRight1 = portSymbolPoints("RIGHT", "eport", k1);
    expect(cRight1).not.toBe(eRight1);

    // 2倍ズームでは座標が2倍になる
    const cRight2 = portSymbolPoints("RIGHT", "cport", k2);
    const parseNums = (pts: string) => pts.trim().split(/[\s,]+/).map(Number);
    const n1 = parseNums(cRight1);
    const n2 = parseNums(cRight2);
    expect(n2.length).toBe(6);
    for (let i = 0; i < 6; i += 1) {
      expect(n2[i]).toBeCloseTo(n1[i]! * 2, 4);
    }

    // 呼び口 RIGHT は外向き（正の x 頂点）、受け口 RIGHT は内向き（負の x 頂点）
    expect(Math.max(...[n1[0]!, n1[2]!, n1[4]!])).toBeCloseTo(2.598 * k1, 2);
    const ne1 = parseNums(eRight1);
    expect(Math.min(...[ne1[0]!, ne1[2]!, ne1[4]!])).toBeCloseTo(-2.598 * k1, 2);
  });

  it("renders different polygon points for cport and eport in CellRenderer at 100% vs 200%", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tNode {
        call sSig cCall;
        entry sSig eEntry;
      };
      cell tNode cN {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const cell = doc.cellValues()[0]!;
    const renderer = new CellRenderer();
    const view1: CanvasView = {
      zoom: 1,
      gridVisible: false,
      hiddenRegionIds: new Set(),
      regionColors: null,
      showSignatureNames: false,
      emphasizeCellName: false,
    };
    const view2: CanvasView = { ...view1, zoom: 2 };

    const g1 = renderer.createElement(cell, { view: view1, doc });
    const g2 = renderer.createElement(cell, { view: view2, doc });

    const cPts1 = g1.querySelector(".port-symbol-cport")!.getAttribute("points")!;
    const cPts2 = g2.querySelector(".port-symbol-cport")!.getAttribute("points")!;
    expect(cPts1).not.toBe(cPts2);
  });
});

describe("V0.3.0 Stage 3A — 2-18: navigator minimap renders cells and joins", () => {
  it("draws miniaturized cell rectangles and join polylines inside the navigator SVG", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tCli { call sSig c; };
      celltype tSrv { entry sSig e; };
      cell tSrv cSrv {};
      cell tCli cCli { c = cSrv.e; };
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const store = new AppStore(doc);

    const root = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    root.appendChild(svg);
    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "clientWidth", { value: 200 });
    Object.defineProperty(scrollEl, "clientHeight", { value: 150 });

    const nav = new NavigatorView(root, store, scrollEl);
    nav.render();

    const cells = svg.querySelectorAll(".navigator-cell");
    const joins = svg.querySelectorAll(".navigator-join");
    expect(cells.length).toBe(2);
    expect(joins.length).toBe(1);
  });
});

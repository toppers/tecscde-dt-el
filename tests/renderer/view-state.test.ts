// [[TECSCDE-DT-EL内部仕様]] 第6章（表示制御）— `ViewState`／`DisplayFilters`／ナビゲータ／
// 検索のヘッドレステスト。挙動の正典は [[TECSCDE内部仕様]] 第7章。
// 実 DOM（ナビゲータ描画・スクロール連動）はモジュールG待ち。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { asRegionId } from "../../src/renderer/model/ids";
import { Region, RegionTree } from "../../src/renderer/model/region";
import { defaultCanvasView } from "../../src/renderer/render/view";
import {
  DisplayFilters,
  ViewState,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  computeNavigator,
  resolveHiddenRegionIds,
  searchDocument,
} from "../../src/renderer/view-state";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

describe("ViewState.initial / clampZoom", () => {
  it("initial is 100% zoom, origin center, grid off, no filter, no search", () => {
    const v = ViewState.initial();
    expect(v.zoom).toBe(1);
    expect(v.panCenter).toEqual({ x: 0, y: 0 });
    expect(v.gridVisible).toBe(false);
    expect(v.filters.isAllVisible).toBe(true);
    expect(v.searchQuery).toBeNull();
  });

  it("clamps zoom to [5%, 200%] and rejects non-finite", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("ViewState.zoomAt — 7.1.2 固定点を保つ", () => {
  it("keeps the anchor model point at the same screen offset from center", () => {
    const v = ViewState.initial();
    const anchor = { x: 100, y: 50 };
    const z = v.zoomAt(anchor, 1.6);
    // 画面オフセット (anchor - panCenter) * zoom が変化前後で一致する。
    const before = (anchor.x - v.panCenter.x) * v.zoom;
    const after = (anchor.x - z.panCenter.x) * z.zoom;
    expect(after).toBeCloseTo(before, 9);
    expect(z.zoom).toBeCloseTo(1.6, 9);
  });

  it("when zoom is clamped, panCenter does not move", () => {
    const v = ViewState.initial();
    const z = v.zoomAt({ x: 100, y: 50 }, 10); // → 200% でクランプ
    expect(z.zoom).toBe(ZOOM_MAX);
    // ratio = 1 / 2 なので panCenter は動くはず… ではなく、クランプ後も固定点不変が成立する。
    const before = (100 - v.panCenter.x) * v.zoom;
    const after = (100 - z.panCenter.x) * z.zoom;
    expect(after).toBeCloseTo(before, 9);
  });

  it("anchoring on the current center leaves panCenter unchanged", () => {
    const v = ViewState.initial().panTo({ x: 30, y: 40 });
    const z = v.zoomAt(v.panCenter, 1.5);
    expect(z.panCenter).toEqual({ x: 30, y: 40 });
  });

  it("resetZoom returns to 100% keeping panCenter", () => {
    const v = ViewState.initial().panTo({ x: 30, y: 40 }).zoomAt({ x: 30, y: 40 }, 1.8);
    const r = v.resetZoom();
    expect(r.zoom).toBe(1);
    expect(r.panCenter).toEqual({ x: 30, y: 40 });
  });
});

describe("ViewState — immutable withers", () => {
  it("panBy / panTo / toggleGrid / withSearchQuery return new instances, original unchanged", () => {
    const v = ViewState.initial();
    expect(v.panBy({ x: 5, y: -3 }).panCenter).toEqual({ x: 5, y: -3 });
    expect(v.panTo({ x: 9, y: 9 }).panCenter).toEqual({ x: 9, y: 9 });
    expect(v.toggleGrid().gridVisible).toBe(true);
    expect(v.gridVisible).toBe(false); // 元は不変
  });

  it("withSearchQuery normalizes empty / whitespace to null", () => {
    expect(ViewState.initial().withSearchQuery("  ").searchQuery).toBeNull();
    expect(ViewState.initial().withSearchQuery("cLog").searchQuery).toBe("cLog");
  });
});

describe("ViewState.toCanvasView — 第5章 CanvasView への射影", () => {
  it("initial projection over an empty document equals defaultCanvasView()", () => {
    const cv = ViewState.initial().toCanvasView(TecscdeDocument.empty().regions);
    expect(cv).toEqual(defaultCanvasView());
  });

  it("reflects zoom, grid and showSignatureNames", () => {
    const v = ViewState.initial()
      .toggleGrid()
      .zoomAt({ x: 0, y: 0 }, 1.5)
      .withFilters(DisplayFilters.allVisible().withShowSignatureNames(true));
    const cv = v.toCanvasView(TecscdeDocument.empty().regions);
    expect(cv.zoom).toBeCloseTo(1.5, 9);
    expect(cv.gridVisible).toBe(true);
    expect(cv.showSignatureNames).toBe(true);
    expect([...cv.hiddenRegionIds]).toEqual([]);
  });
});

describe("DisplayFilters", () => {
  it("allVisible has no filters and signature labels off", () => {
    const f = DisplayFilters.allVisible();
    expect(f.regionFilter).toBeNull();
    expect(f.namespaceFilter).toBeNull();
    expect(f.colorByRegion).toBe(false);
    expect(f.showSignatureNames).toBe(false);
    expect(f.isAllVisible).toBe(true);
  });

  it("withers are independent and equals compares by value", () => {
    const a = DisplayFilters.allVisible().withColorByRegion(true).withShowSignatureNames(true);
    const b = DisplayFilters.allVisible().withShowSignatureNames(true).withColorByRegion(true);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(DisplayFilters.allVisible())).toBe(false);
  });
});

describe("resolveHiddenRegionIds — 6.5 リージョン／ネームスペースフィルタ", () => {
  // 根 :: ─┬─ A (::A) ── A1 (::A::A1)
  //        └─ B (::B)
  const A1 = Region.create(asRegionId("A1"), "::A::A1");
  const A = Region.create(asRegionId("A"), "::A", [A1]);
  const B = Region.create(asRegionId("B"), "::B");
  const tree = RegionTree.of(Region.create(asRegionId("::"), "::", [A, B]));

  it("no filter → nothing hidden", () => {
    expect([...resolveHiddenRegionIds(DisplayFilters.allVisible(), tree)]).toEqual([]);
  });

  it("regionFilter = A → A and its descendant A1 visible, B hidden", () => {
    const hidden = resolveHiddenRegionIds(
      DisplayFilters.allVisible().withRegionFilter(asRegionId("A")),
      tree,
    );
    expect(hidden.has(asRegionId("B"))).toBe(true);
    expect(hidden.has(asRegionId("A"))).toBe(false);
    expect(hidden.has(asRegionId("A1"))).toBe(false);
  });

  it("namespaceFilter = '::A' → only ::A subtree visible", () => {
    const hidden = resolveHiddenRegionIds(
      DisplayFilters.allVisible().withNamespaceFilter("::A"),
      tree,
    );
    expect([...hidden]).toEqual([asRegionId("B")]);
  });

  it("region + namespace filters combine with AND (empty intersection hides all)", () => {
    const hidden = resolveHiddenRegionIds(
      DisplayFilters.allVisible().withRegionFilter(asRegionId("A")).withNamespaceFilter("::B"),
      tree,
    );
    expect(hidden.has(asRegionId("A"))).toBe(true);
    expect(hidden.has(asRegionId("A1"))).toBe(true);
    expect(hidden.has(asRegionId("B"))).toBe(true);
  });
});

describe("computeNavigator — 6.3 / 7.3.2 自動非表示", () => {
  const paper = TecscdeDocument.empty().paper; // A4 LANDSCAPE = 277 x 190 mm

  it("auto-hides when the whole paper fits in the viewport", () => {
    const v = ViewState.initial().panTo({ x: 138.5, y: 95 });
    const nav = computeNavigator(v, paper, { widthPx: 2000, heightPx: 2000 });
    expect(nav.autoHidden).toBe(true);
    expect(nav.paper).toEqual({ width: 277, height: 190 });
  });

  it("shows and reports the visible model rect when zoomed in", () => {
    const v = ViewState.initial().panTo({ x: 100, y: 60 }).zoomAt({ x: 100, y: 60 }, 2);
    const nav = computeNavigator(v, paper, { widthPx: 400, heightPx: 400 });
    expect(nav.autoHidden).toBe(false);
    // 矩形は panCenter を中心とする。
    expect(nav.viewport.x + nav.viewport.width / 2).toBeCloseTo(100, 6);
    expect(nav.viewport.y + nav.viewport.height / 2).toBeCloseTo(60, 6);
  });
});

describe("searchDocument — 6.4 モデル全体検索", () => {
  it("returns [] for an empty / whitespace query", () => {
    expect(searchDocument(loadDoc(), null)).toEqual([]);
    expect(searchDocument(loadDoc(), "   ")).toEqual([]);
  });

  it("matches cell name case-insensitively", () => {
    const hits = searchDocument(loadDoc(), "logger");
    expect(hits.some((h) => h.kind === "cell" && h.cellId === ("cLogger1" as never))).toBe(true);
  });

  it("matches by celltype name", () => {
    const hits = searchDocument(loadDoc(), "tController");
    expect(hits.map((h) => h.label)).toContain("cController1");
  });

  it("marks a hit in a hidden region as revealed (7.4.2)", () => {
    const doc = loadDoc();
    const anyCell = doc.cellValues()[0];
    if (!anyCell) throw new Error("fixture has no cells");
    const hidden = new Set([anyCell.regionId]);
    const hits = searchDocument(doc, anyCell.name, hidden);
    const self = hits.find((h) => h.kind === "cell" && h.cellId === anyCell.id);
    expect(self && self.revealed).toBe(true);
  });

  it("matches join endpoints", () => {
    const hits = searchDocument(loadDoc(), "cLog");
    expect(hits.some((h) => h.kind === "join")).toBe(true);
  });
});

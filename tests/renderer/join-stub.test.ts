/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.5 — 結合のスタブ（一端だけ非表示）。

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { asCellId, asJoinId, asRegionId } from "../../src/renderer/model/ids";
import { HitTester } from "../../src/renderer/render/hit-tester";
import { JoinRenderer } from "../../src/renderer/render/join-renderer";
import { SvgRenderer } from "../../src/renderer/render/svg-renderer";
import {
  STUB_LEN_MM,
  joinPolyline,
  joinStub,
  stubTick,
  truncatePolyline,
} from "../../src/renderer/render/svg-path";
import { defaultCanvasView, SelectionState, type CanvasView } from "../../src/renderer/render/view";
import type { Cell } from "../../src/renderer/model/cell";
import type { Join } from "../../src/renderer/model/join";
import type { Point } from "../../src/renderer/model/geometry";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const pts = (...xy: Array<[number, number]>): Point[] => xy.map(([x, y]) => ({ x, y }));

describe("truncatePolyline — 6B.5", () => {
  const path = pts([0, 0], [10, 0], [10, 10]);

  it("returns the whole path when it is shorter than the length", () => {
    expect(truncatePolyline(path, 100)).toEqual(path);
  });

  it("cuts inside the first segment", () => {
    expect(truncatePolyline(path, 4)).toEqual(pts([0, 0], [4, 0]));
  });

  it("keeps going around a corner", () => {
    expect(truncatePolyline(path, 14)).toEqual(pts([0, 0], [10, 0], [10, 4]));
  });

  it("returns just the start for a non-positive length", () => {
    expect(truncatePolyline(path, 0)).toEqual(pts([0, 0]));
  });
});

describe("stubTick — 6B.5", () => {
  it("is perpendicular to the last segment, centered on its end", () => {
    const [a, b] = stubTick(pts([0, 0], [4, 0]), 2);
    expect(a).toEqual({ x: 4, y: 1 });
    expect(b).toEqual({ x: 4, y: -1 });
    const [c, d] = stubTick(pts([0, 0], [0, 4]), 2);
    expect(c).toEqual({ x: -1, y: 4 });
    expect(d).toEqual({ x: 1, y: 4 });
  });
});

describe("joinStub — 6B.5", () => {
  const path = pts([0, 0], [10, 0], [10, 10], [30, 10]);

  it("returns the full path (original segment indices) when nothing is hidden", () => {
    expect(joinStub(path, false, false)).toEqual({ points: path, segmentIndices: [0, 1, 2], isStub: false });
  });

  it("returns undefined when both ends are hidden", () => {
    expect(joinStub(path, true, true)).toBeUndefined();
  });

  it("target hidden: stub grows from the start and keeps segment indices", () => {
    const stub = joinStub(path, false, true)!;
    expect(stub.isStub).toBe(true);
    expect(stub.points).toEqual(truncatePolyline(path, STUB_LEN_MM));
    expect(stub.segmentIndices).toEqual([0]);
  });

  it("source hidden: stub grows from the end, reversed, with mapped indices", () => {
    const stub = joinStub(path, true, false)!;
    expect(stub.points[0]).toEqual({ x: 30, y: 10 });
    expect(stub.points[stub.points.length - 1]).toEqual({ x: 30 - STUB_LEN_MM, y: 10 });
    expect(stub.segmentIndices).toEqual([2]);
  });
});

// --- 描画・ヒットテスト ---

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function loadFixture(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

/** 呼び口側 c1 が B、受け口側 l1 が A に属する、結合1本の文書。 */
function loadRegions(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    {
      text: "region A { cell tLogger l1 {}; }; region B { cell tController c1 { cLog = l1.eLog; }; };",
      fileName: "main.cde",
      editable: true,
    },
  ]).document;
}

const hiddenView = (...ids: string[]): CanvasView => ({
  ...defaultCanvasView(),
  hiddenRegionIds: new Set(ids.map(asRegionId)),
});

const newSvg = (): SVGSVGElement => document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;

describe("JoinRenderer — stub (6B.5)", () => {
  let join: Join;
  let source: Cell;
  let target: Cell;
  let full: readonly Point[];
  const renderer = new JoinRenderer();

  // CDLパーサの初期化（tests/setup.ts）を待ってから読み込む。
  beforeAll(() => {
    const doc = loadFixture();
    join = doc.getJoin(asJoinId("cController1.cLog"))!;
    source = doc.getCell(join.cellId)!;
    target = doc.getCell(join.eportCellId)!;
    full = joinPolyline(join, source, target)!;
  });

  it("draws a short polyline, a tick and a title when only the target is hidden", () => {
    const g = renderer.createElement(join, { view: defaultCanvasView(), source, target, targetHidden: true });
    expect(g.querySelector("polyline.join-stub")).not.toBeNull();
    expect(g.querySelector("line.join-stub-tick")).not.toBeNull();
    expect(g.querySelector("title")?.textContent).toContain(target.name);
    expect(g.querySelector(".signature-label")).toBeNull();
    const k = 96 / 25.4;
    const drawn = g.querySelector("polyline.join-stub")!.getAttribute("points")!.split(" ");
    expect(drawn[0]).toBe(`${full[0]!.x * k},${full[0]!.y * k}`);
  });

  it("draws the normal line when nothing is hidden", () => {
    const g = renderer.createElement(join, { view: defaultCanvasView(), source, target });
    expect(g.querySelector("polyline.join-stub")).toBeNull();
    expect(g.querySelector("polyline.join-line")).not.toBeNull();
  });
});

describe("SvgRenderer — hidden joins (6B.5)", () => {
  it("renders a stub for a join whose one end is in a hidden region, and hides it when both are", () => {
    const model = loadRegions();
    const svg = newSvg();
    const renderer = new SvgRenderer(svg);
    const joinId = model.joinValues()[0]!.id;
    const group = (): SVGGElement => svg.querySelector<SVGGElement>(`[data-join-id='${joinId}']`)!;

    renderer.render(model, hiddenView("::A"), SelectionState.empty());
    expect(group().style.display).toBe("");
    expect(group().querySelector("polyline.join-stub")).not.toBeNull();

    renderer.render(model, hiddenView("::A", "::B"), SelectionState.empty());
    expect(group().style.display).toBe("none");

    renderer.render(model, hiddenView(), SelectionState.empty());
    expect(group().querySelector("polyline.join-stub")).toBeNull();
    expect(group().querySelector("polyline.join-line")).not.toBeNull();
  });

  it("draws the selection outline along the stub only", () => {
    const model = loadRegions();
    const svg = newSvg();
    const joinId = model.joinValues()[0]!.id;
    new SvgRenderer(svg).render(model, hiddenView("::A"), SelectionState.ofJoin(joinId));
    const outline = svg.querySelector("polyline.join-selected")!;
    const stub = svg.querySelector("polyline.join-stub")!;
    expect(outline.getAttribute("points")!.split(" ").length).toBe(stub.getAttribute("points")!.split(" ").length);
  });
});

describe("HitTester — hidden regions (6B.5)", () => {
  let model: TecscdeDocument;
  let inside: Point;

  beforeAll(() => {
    model = loadRegions();
    const l1 = model.getCell(asCellId("l1"))!;
    inside = { x: l1.x + l1.width / 2, y: l1.y + l1.height / 2 };
  });

  it("ignores hidden cells for point and rectangle hits", () => {
    expect(new HitTester(model, defaultCanvasView()).hitTest(inside)).toEqual({ kind: "cell", cellId: asCellId("l1") });
    expect(new HitTester(model, hiddenView("::A")).hitTest(inside)).toEqual({ kind: "none" });
    const rect = new HitTester(model, hiddenView("::A")).hitTestRect({ x: -1000, y: -1000 }, { x: 1000, y: 1000 });
    expect(rect).not.toContain(asCellId("l1"));
    expect(rect).toContain(asCellId("c1"));
  });

  it("hits a join bar only along the stub when one end is hidden", () => {
    const join = model.joinValues()[0]!;
    const points = joinPolyline(join, model.getCell(join.cellId)!, model.getCell(join.eportCellId)!)!;
    // ポート記号の掴み判定（半径2.5mm）に入らない、端から3.3mmの位置を使う。
    const along = (p: Point, q: Point, mm: number): Point => {
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const t = Math.min(0.9, mm / len);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    // 呼び口(c1, B)側は可視、受け口(l1, A)側が非表示 → 呼び口に近い所だけ当たる。
    const tester = new HitTester(model, hiddenView("::A"));
    const nearStart = along(points[0]!, points[1]!, 3.3);
    const nearEnd = along(points[points.length - 1]!, points[points.length - 2]!, 3.3);
    expect(tester.hitTest(nearStart).kind).toBe("joinBar");
    expect(tester.hitTest(nearEnd).kind).not.toBe("joinBar");
  });
});

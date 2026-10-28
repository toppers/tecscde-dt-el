// [[TECSCDE-DT-EL内部仕様]] 第5章5.1節 — `SvgRenderer`。
//
// キャンバスのルートは単一の `<svg>`（外部仕様3.2.2）。`CellId`/`JoinId` と `<g>` 要素の
// 対応を `Map` で保持し、モデル変更時は差分のある要素だけを `updateElement` で更新する。
// [[TECSCDE内部仕様]] 3.2.2 が禁じる「図全体の再描画」は、この対応表を持つことで
// 構造的に発生しない（差分がなければどの要素も触らない）。
//
// DOM/SVGへアクセスするため renderer プロセスでのみ動作する（第2章2.3節）。

import { CellRenderer } from "./cell-renderer";
import { JoinRenderer } from "./join-renderer";
import { setAttrs, svgEl } from "./element-renderer";
import { joinPolyline, joinStub } from "./svg-path";
import { pxPerMm, type CanvasView, type SelectionState } from "./view";
import { ALIGN_MM } from "../model/align";
import type { Bar, Join } from "../model/join";
import type { Cell } from "../model/cell";
import type { CellId, JoinId, RegionId } from "../model/ids";
import { portPosition, type Point } from "../model/geometry";
import type { TecscdeDocument } from "../model/document";
import type { SearchHighlights } from "./search-highlights";

export interface JoinPreviewLine {
  readonly from: Point;
  readonly to: Point;
}

export interface RenderOptions {
  readonly searchHighlights?: SearchHighlights;
  /** 結合作成ドラッグ中の仮結線（5.5節・[[TECSCDE内部仕様]] 6.6節）。 */
  readonly joinPreview?: JoinPreviewLine;
}

/** グリッド線の間隔（ALIGNの10倍ごとに1本）。 */
const GRID_STEP_MM = ALIGN_MM * 10;

export class SvgRenderer {
  private readonly gridLayer: SVGGElement;
  private readonly cellLayer: SVGGElement;
  private readonly joinLayer: SVGGElement;
  private readonly previewLayer: SVGGElement;
  private readonly selectionLayer: SVGGElement;

  private readonly cellElements = new Map<CellId, SVGGElement>();
  private readonly joinElements = new Map<JoinId, SVGGElement>();
  private readonly cellRenderer = new CellRenderer();
  private readonly joinRenderer = new JoinRenderer();

  private lastDoc: TecscdeDocument | undefined;
  private lastView: CanvasView | undefined;
  private lastHighlights: SearchHighlights | undefined;
  private readonly joinBarPreviews = new Map<JoinId, readonly Bar[]>();

  constructor(private readonly svg: SVGSVGElement) {
    // 5.1節スケッチの順序: #cells, #joins, #join-preview, #selection-overlay, #grid。
    this.cellLayer = this.makeLayer("cells");
    this.joinLayer = this.makeLayer("joins");
    this.previewLayer = this.makeLayer("join-preview");
    this.selectionLayer = this.makeLayer("selection-overlay");
    this.gridLayer = this.makeLayer("grid");
    // 結合はセルの背面に置く（折れ線がセル矩形へ潜り込んで見えるのを避ける）。
    this.svg.append(this.joinLayer, this.cellLayer, this.previewLayer, this.selectionLayer, this.gridLayer);
  }

  private makeLayer(id: string): SVGGElement {
    const g = svgEl("g");
    g.setAttribute("id", id);
    return g;
  }

  /**
   * 現在のドキュメント・表示状態・選択を反映する。前回描画時との差分だけを更新する。
   * ズーム等の表示状態が変わった場合は全要素を座標再計算する（モデル差分とは別軸）。
   */
  render(
    doc: TecscdeDocument,
    view: CanvasView,
    selection: SelectionState,
    opts: RenderOptions = {},
  ): void {
    const viewChanged = !viewEquals(this.lastView, view);
    this.updateCanvasSize(doc, view);
    this.reconcileCells(doc, view, viewChanged, opts.searchHighlights);
    this.reconcileJoins(doc, view, viewChanged, opts.searchHighlights);
    this.renderGrid(doc, view);
    this.renderSelectionOverlay(doc, view, selection);
    this.renderJoinPreview(view, opts.joinPreview);
    this.lastDoc = doc;
    this.lastView = view;
    this.lastHighlights = opts.searchHighlights;
  }

  /** 5.1節スケッチの名前。`render` の薄い別名（prev は差分計算に用いず内部状態を使う）。 */
  onDocumentChanged(
    _prev: TecscdeDocument | undefined,
    next: TecscdeDocument,
    view: CanvasView,
    selection: SelectionState,
    opts: RenderOptions = {},
  ): void {
    this.render(next, view, selection, opts);
  }

  private updateCanvasSize(doc: TecscdeDocument, view: CanvasView): void {
    const { width, height } = doc.paper.contentSize();
    const k = pxPerMm(view);
    setAttrs(this.svg, { width: width * k, height: height * k });
  }

  private reconcileCells(doc: TecscdeDocument, view: CanvasView, viewChanged: boolean, highlights?: SearchHighlights): void {
    for (const [id, group] of this.cellElements) {
      if (!doc.getCell(id)) {
        group.remove();
        this.cellElements.delete(id);
      }
    }
    for (const cell of doc.cellValues()) {
      const hidden = view.hiddenRegionIds.has(cell.regionId);
      const searchMatch = !hidden && highlights?.cellIds.has(cell.id) === true;
      const matchChanged = (highlights?.cellIds.has(cell.id) === true) !==
        (this.lastHighlights?.cellIds.has(cell.id) === true);
      const ctx = { view, searchMatch };
      let group = this.cellElements.get(cell.id);
      if (!group) {
        group = this.cellRenderer.createElement(cell, ctx);
        this.cellLayer.appendChild(group);
        this.cellElements.set(cell.id, group);
      } else if (viewChanged || matchChanged || this.lastDoc?.getCell(cell.id) !== cell) {
        this.cellRenderer.updateElement(cell, group, ctx);
      }
      group.style.display = hidden ? "none" : "";
    }
  }

  private reconcileJoins(doc: TecscdeDocument, view: CanvasView, viewChanged: boolean, highlights?: SearchHighlights): void {
    for (const [id, group] of this.joinElements) {
      const join = doc.getJoin(id);
      if (!join || !doc.getCell(join.cellId) || !doc.getCell(join.eportCellId)) {
        group.remove();
        this.joinElements.delete(id);
        this.joinBarPreviews.delete(id);
      }
    }
    for (const join of doc.joinValues()) {
      const source = doc.getCell(join.cellId);
      const target = doc.getCell(join.eportCellId);
      if (!source || !target) continue;
      // 第6B章6B.5: 両端が非表示なら消し、一端だけなら可視側にスタブを描く。
      const sourceHidden = view.hiddenRegionIds.has(source.regionId);
      const targetHidden = view.hiddenRegionIds.has(target.regionId);
      const hidden = sourceHidden && targetHidden;
      const searchMatch = !hidden && highlights?.joinIds.has(join.id) === true;
      const matchChanged = (highlights?.joinIds.has(join.id) === true) !==
        (this.lastHighlights?.joinIds.has(join.id) === true);
      const ctx = { view, source, target, sourceHidden, targetHidden, searchMatch, bars: this.joinBarPreviews.get(join.id) };
      let group = this.joinElements.get(join.id);
      const endpointsChanged =
        this.lastDoc?.getCell(join.cellId) !== source || this.lastDoc?.getCell(join.eportCellId) !== target;
      if (!group) {
        group = this.joinRenderer.createElement(join, ctx);
        this.joinLayer.appendChild(group);
        this.joinElements.set(join.id, group);
      } else if (viewChanged || matchChanged || this.lastDoc?.getJoin(join.id) !== join || endpointsChanged) {
        this.joinRenderer.updateElement(join, group, ctx);
      }
      group.style.display = hidden ? "none" : "";
    }
  }

  private renderGrid(doc: TecscdeDocument, view: CanvasView): void {
    this.gridLayer.replaceChildren();
    this.gridLayer.style.display = view.gridVisible ? "" : "none";
    if (!view.gridVisible) return;
    const { width, height } = doc.paper.contentSize();
    const k = pxPerMm(view);
    for (let x = 0; x <= width; x += GRID_STEP_MM) {
      const line = svgEl("line");
      setAttrs(line, { x1: x * k, x2: x * k, y1: 0, y2: height * k });
      line.setAttribute("class", "grid-line");
      this.gridLayer.appendChild(line);
    }
    for (let y = 0; y <= height; y += GRID_STEP_MM) {
      const line = svgEl("line");
      setAttrs(line, { x1: 0, x2: width * k, y1: y * k, y2: y * k });
      line.setAttribute("class", "grid-line");
      this.gridLayer.appendChild(line);
    }
  }

  private renderSelectionOverlay(
    doc: TecscdeDocument,
    view: CanvasView,
    selection: SelectionState,
  ): void {
    this.selectionLayer.replaceChildren();
    const k = pxPerMm(view);
    for (const selected of selection.ports) {
      const cell = doc.getCell(selected.cellId);
      if (!cell || view.hiddenRegionIds.has(cell.regionId)) continue;
      const ports = selected.kind === "cport" ? cell.cports : cell.eports;
      const port = ports.find((candidate) => candidate.name === selected.portName && candidate.subscript === selected.subscript);
      if (!port) continue;
      const point = portPosition(cell, port);
      const circle = svgEl("circle");
      setAttrs(circle, { cx: point.x * k, cy: point.y * k, r: 2.5 * k });
      circle.setAttribute("class", "selection-outline port-selected");
      circle.setAttribute("fill", "none");
      this.selectionLayer.appendChild(circle);
    }
    for (const id of selection.cellIds) {
      const cell = doc.getCell(id);
      if (!cell) continue;
      const rect = svgEl("rect");
      setAttrs(rect, {
        x: cell.x * k - 2,
        y: cell.y * k - 2,
        width: cell.width * k + 4,
        height: cell.height * k + 4,
      });
      rect.setAttribute("class", "selection-outline");
      rect.setAttribute("fill", "none");
      this.selectionLayer.appendChild(rect);
    }
    for (const id of selection.joinIds) {
      const join = doc.getJoin(id);
      if (!join) continue;
      const source = doc.getCell(join.cellId);
      const target = doc.getCell(join.eportCellId);
      if (!source || !target) continue;
      const full = joinPolyline(join, source, target);
      if (!full) continue;
      // 一端が非表示の結合は、描かれているスタブの部分だけを選択枠にする（6B.5）。
      const parts = joinStub(
        full,
        view.hiddenRegionIds.has(source.regionId),
        view.hiddenRegionIds.has(target.regionId),
      );
      if (!parts) continue;
      const points = parts.points;
      const line = svgEl("polyline");
      setAttrs(line, { points: points.map((p) => `${p.x * k},${p.y * k}`).join(" ") });
      line.setAttribute("class", "selection-outline join-selected");
      line.setAttribute("fill", "none");
      this.selectionLayer.appendChild(line);
    }
  }

  private renderJoinPreview(view: CanvasView, preview: JoinPreviewLine | undefined): void {
    this.previewLayer.replaceChildren();
    if (!preview) return;
    const k = pxPerMm(view);
    const line = svgEl("line");
    setAttrs(line, {
      x1: preview.from.x * k,
      y1: preview.from.y * k,
      x2: preview.to.x * k,
      y2: preview.to.y * k,
    });
    line.setAttribute("class", "join-preview");
    this.previewLayer.appendChild(line);
  }

  // --- ドラッグ中の暫定表示（モデル・履歴には書き込まない、見た目だけ、5.4/5.5節） ---

  /** 移動中セルの見た目だけを平行移動する（コミットは mouseup 時の1コマンドのみ）。 */
  setDragPreview(cellIds: ReadonlySet<CellId>, dxPx: number, dyPx: number): void {
    for (const [id, group] of this.cellElements) {
      if (cellIds.has(id)) group.setAttribute("transform", `translate(${dxPx}, ${dyPx})`);
    }
  }

  clearDragPreview(): void {
    for (const group of this.cellElements.values()) group.removeAttribute("transform");
  }

  /** 結合バードラッグ中: 対象 join の polyline だけを仮 `bars` で描き直す。 */
  setJoinBarPreview(
    join: Join,
    bars: readonly Bar[],
    source: Cell,
    target: Cell,
    view: CanvasView,
  ): void {
    const group = this.joinElements.get(join.id);
    if (!group) return;
    this.joinBarPreviews.set(join.id, bars);
    this.joinRenderer.previewBars(group, join, {
      view, source, target,
      sourceHidden: view.hiddenRegionIds.has(source.regionId),
      targetHidden: view.hiddenRegionIds.has(target.regionId),
    }, bars);
  }

  /** Restore both the normal line and search underlay to confirmed geometry. */
  clearJoinBarPreview(): void {
    const doc = this.lastDoc;
    const view = this.lastView;
    for (const id of this.joinBarPreviews.keys()) {
      const join = doc?.getJoin(id);
      const source = join && doc?.getCell(join.cellId);
      const target = join && doc?.getCell(join.eportCellId);
      const group = this.joinElements.get(id);
      if (!join || !source || !target || !group || !view) continue;
      this.joinRenderer.updateElement(join, group, {
        view, source, target,
        sourceHidden: view.hiddenRegionIds.has(source.regionId),
        targetHidden: view.hiddenRegionIds.has(target.regionId),
        searchMatch: this.lastHighlights?.joinIds.has(id),
      });
    }
    this.joinBarPreviews.clear();
  }

  /** ポートのドラッグ中: 放した場合にポートが移る位置へ印（円）を描く。`undefined` で消去。 */
  setPortDragPreview(view: CanvasView, positions: readonly Point[] | undefined): void {
    Array.from(this.selectionLayer.querySelectorAll("circle.port-drag-preview")).forEach((el) => el.remove());
    if (!positions) return;
    const k = pxPerMm(view);
    for (const p of positions) {
      const dot = svgEl("circle");
      setAttrs(dot, { cx: p.x * k, cy: p.y * k, r: 5 });
      dot.setAttribute("class", "port-drag-preview");
      dot.setAttribute("fill", "#2563eb");
      dot.setAttribute("fill-opacity", "0.55");
      dot.setAttribute("stroke", "#1d4ed8");
      dot.setAttribute("stroke-width", "1.5");
      // 印がポインタを遮らないようにする。
      dot.setAttribute("pointer-events", "none");
      this.selectionLayer.appendChild(dot);
    }
  }

  /** ラバーバンド選択の矩形（モデル座標）。`undefined` で消去。 */
  renderSelectionBox(view: CanvasView, box: { a: Point; b: Point } | undefined): void {
    // セレクション矩形はオーバーレイ層の一時要素として描く（選択強調とは別要素）。
    const existing = this.selectionLayer.querySelector("rect.rubber-band");
    existing?.remove();
    if (!box) return;
    const k = pxPerMm(view);
    const rect = svgEl("rect");
    setAttrs(rect, {
      x: Math.min(box.a.x, box.b.x) * k,
      y: Math.min(box.a.y, box.b.y) * k,
      width: Math.abs(box.a.x - box.b.x) * k,
      height: Math.abs(box.a.y - box.b.y) * k,
    });
    rect.setAttribute("class", "rubber-band");
    rect.setAttribute("fill", "none");
    this.selectionLayer.appendChild(rect);
  }

  /** 画面座標(px, SVG内ローカル)からモデル座標(mm)への変換。 */
  screenToModel(px: Point, view: CanvasView): Point {
    const k = pxPerMm(view);
    return { x: px.x / k, y: px.y / k };
  }

  /** モデル座標(mm)から画面座標(px, SVG内ローカル)への変換。 */
  modelToScreen(pt: Point, view: CanvasView): Point {
    const k = pxPerMm(view);
    return { x: pt.x * k, y: pt.y * k };
  }
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function colorsEqual(
  a: ReadonlyMap<RegionId, string> | null,
  b: ReadonlyMap<RegionId, string> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function viewEquals(a: CanvasView | undefined, b: CanvasView): boolean {
  return (
    a !== undefined &&
    a.zoom === b.zoom &&
    a.gridVisible === b.gridVisible &&
    a.showSignatureNames === b.showSignatureNames &&
    a.emphasizeCellName === b.emphasizeCellName &&
    setsEqual(a.hiddenRegionIds, b.hiddenRegionIds) &&
    colorsEqual(a.regionColors, b.regionColors)
  );
}

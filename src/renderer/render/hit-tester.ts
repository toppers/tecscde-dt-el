// [[TECSCDE-DT-EL内部仕様]] 第5章5.2節 — `HitTester` クラス。
//
// 外部仕様6.2.1の優先順位（ポート＞セル＞結合バー）と、6.2.2が要求する改善
// （結合バー探索を一定ピクセル半径内に限定する。現行版の「モデル全体探索」を改める）を
// 独立したクラスに閉じ込める。
//
// 仕様スケッチの `constructor(doc, renderer, barSearchRadiusPx)` に対し、本実装は
// `renderer` の代わりに `CanvasView` を受け取る —— 要素の位置はモデル（`portPosition` 等）
// から一意に定まり、`renderer` が追加で持つ位置情報は無い。描画層から実際に必要なのは
// 「ピクセル半径をモデル座標(mm)へ換算するためのズーム倍率」だけであり、それは
// `CanvasView` にある（第5章の設計スケッチは仕様書自身が「スケッチ」と明記している）。
//
// `TecscdeDocument` は不変なので、`HitTester` も実質的に不変な値として扱える。
// `GestureController` は `doc` が変わるたびに新しい `HitTester` へ差し替える。

import { pxToMm, type CanvasView } from "./view";
import { joinPolyline } from "./svg-path";
import { portPosition } from "../model/geometry";
import type { Point } from "../model/geometry";
import type { Cell } from "../model/cell";
import type { CellId, JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";

export type HitResult =
  | { readonly kind: "cport"; readonly cellId: CellId; readonly portName: string; readonly subscript: number | null }
  | { readonly kind: "eport"; readonly cellId: CellId; readonly portName: string; readonly subscript: number | null }
  | { readonly kind: "cell"; readonly cellId: CellId }
  | { readonly kind: "joinBar"; readonly joinId: JoinId; readonly barIndex: number }
  | { readonly kind: "none" };

const NONE: HitResult = { kind: "none" };

/** ポート記号の掴み判定半径(mm)。ズームに依らない一定の物理サイズ。 */
const PORT_HIT_RADIUS_MM = 2.5;

/** 結合バー探索のピクセル半径の既定値（外部仕様6.2.2）。 */
const DEFAULT_BAR_SEARCH_RADIUS_PX = 8;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInCell(p: Point, cell: Cell): boolean {
  return p.x >= cell.x && p.x <= cell.x + cell.width && p.y >= cell.y && p.y <= cell.y + cell.height;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export class HitTester {
  private readonly barRadiusMm: number;

  constructor(
    private readonly doc: TecscdeDocument,
    view: CanvasView,
    barSearchRadiusPx: number = DEFAULT_BAR_SEARCH_RADIUS_PX,
  ) {
    this.barRadiusMm = pxToMm(view, barSearchRadiusPx);
  }

  /** モデル座標の1点に対するヒットテスト。優先順位はポート＞セル＞結合バー。 */
  hitTest(point: Point): HitResult {
    return this.hitPort(point) ?? this.hitCell(point) ?? this.hitJoinBar(point) ?? NONE;
  }

  /**
   * 矩形（ラバーバンド選択、外部仕様6.8.2）に完全に含まれるセルのIDを返す。
   * `point` 版とは別に、集合を一度に問い合わせられるようにする（5.4節）。
   */
  hitTestRect(a: Point, b: Point): CellId[] {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const result: CellId[] = [];
    for (const cell of this.doc.cellValues()) {
      if (
        cell.x >= minX &&
        cell.y >= minY &&
        cell.x + cell.width <= maxX &&
        cell.y + cell.height <= maxY
      ) {
        result.push(cell.id);
      }
    }
    return result;
  }

  private hitPort(point: Point): HitResult | undefined {
    for (const cell of this.doc.cellValues()) {
      for (const p of cell.cports) {
        if (distance(point, portPosition(cell, p)) <= PORT_HIT_RADIUS_MM) {
          return { kind: "cport", cellId: cell.id, portName: p.name, subscript: p.subscript };
        }
      }
      for (const p of cell.eports) {
        if (distance(point, portPosition(cell, p)) <= PORT_HIT_RADIUS_MM) {
          return { kind: "eport", cellId: cell.id, portName: p.name, subscript: p.subscript };
        }
      }
    }
    return undefined;
  }

  private hitCell(point: Point): HitResult | undefined {
    for (const cell of this.doc.cellValues()) {
      if (pointInCell(point, cell)) return { kind: "cell", cellId: cell.id };
    }
    return undefined;
  }

  private hitJoinBar(point: Point): HitResult | undefined {
    let best: { joinId: JoinId; barIndex: number; d: number } | undefined;
    for (const join of this.doc.joinValues()) {
      const source = this.doc.getCell(join.cellId);
      const target = this.doc.getCell(join.eportCellId);
      if (!source || !target) continue;
      const points = joinPolyline(join, source, target);
      if (!points) continue;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (!a || !b) continue;
        const d = distanceToSegment(point, a, b);
        if (d <= this.barRadiusMm && (!best || d < best.d)) {
          best = { joinId: join.id, barIndex: i, d };
        }
      }
    }
    return best ? { kind: "joinBar", joinId: best.joinId, barIndex: best.barIndex } : undefined;
  }
}

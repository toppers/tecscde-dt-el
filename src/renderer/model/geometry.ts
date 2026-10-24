// TECSCDE-TS内部仕様 3章 — 座標計算の純粋関数。DOM/SVGを知らない（モジュールCの一部）。
// パーサ(B)の自動経路生成と、描画層(E)のポート位置計算の両方から使われる。

import { alignRound } from "./align";
import type { Cell } from "./cell";
import type { Bar } from "./join";
import type { EdgeSide, Port } from "./port";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 結合のポート・折れ点間の最小距離（外部仕様4.6.1: DIST_PORT = 4mm）。 */
export const DIST_PORT_MM = 4;

export function portPosition(cell: Cell, port: Port): Point {
  switch (port.edgeSide) {
    case "TOP":
      return { x: cell.x + port.offset, y: cell.y };
    case "BOTTOM":
      return { x: cell.x + port.offset, y: cell.y + cell.height };
    case "LEFT":
      return { x: cell.x, y: cell.y + port.offset };
    case "RIGHT":
      return { x: cell.x + cell.width, y: cell.y + port.offset };
  }
}

function stepOutward(p: Point, edge: EdgeSide, dist: number): Point {
  switch (edge) {
    case "TOP":
      return { x: p.x, y: p.y - dist };
    case "BOTTOM":
      return { x: p.x, y: p.y + dist };
    case "LEFT":
      return { x: p.x - dist, y: p.y };
    case "RIGHT":
      return { x: p.x + dist, y: p.y };
  }
}

function segment(a: Point, b: Point): Bar | undefined {
  if (a.x === b.x && a.y === b.y) return undefined;
  if (a.x === b.x) return { direction: "V", fixed: a.x, from: a.y, to: b.y };
  if (a.y === b.y) return { direction: "H", fixed: a.y, from: a.x, to: b.x };
  // 斜めになってしまう場合は水平→垂直の2区間に分解する（10.3 #4: 斜線を用いない）
  return undefined;
}

/** 軸に平行な矩形（mm）。`Cell` も構造的にこの型を満たす。 */
export interface RectMm {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 折れ線（点列）を水平・垂直のバーへ。長さ0の区間は落とす。 */
function barsOf(points: readonly Point[]): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const bar = segment(points[i] as Point, points[i + 1] as Point);
    if (bar) bars.push(bar);
  }
  return bars;
}

/** 軸平行な線分 a-b が、矩形の内部を（正の長さで）横切るか。縁に沿うだけ・接するだけは含めない。 */
function crossesRect(a: Point, b: Point, rect: RectMm): boolean {
  if (a.y === b.y) {
    return (
      a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width
    );
  }
  if (a.x === b.x) {
    return (
      a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    );
  }
  return false;
}

/** ポート直後の点（p1）から p2 までの区間が横切る矩形の数。ポートから出る・入る短い区間は数えない。 */
function collisionCount(points: readonly Point[], obstacles: readonly RectMm[]): number {
  const middle = points.slice(1, -1);
  let count = 0;
  for (const rect of obstacles) {
    for (let i = 0; i + 1 < middle.length; i += 1) {
      if (crossesRect(middle[i] as Point, middle[i + 1] as Point, rect)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }
  return total;
}

/**
 * 呼び口・受け口の位置から自動的に折れ線経路を生成する（外部仕様4.6.2、7.3.2）。
 * 水平・垂直の線分のみで構成し、ポートから DIST_PORT 分の距離を確保する。
 *
 * `obstacles`（他のセルの矩形）を渡すと、既定のL字経路が矩形と重なるときに限り、もう一方のL字と、
 * 矩形の外側を回るコの字（Z字）経路を候補に加え、交差の少ない（同数なら短い）ものを選ぶ。
 * 既定の経路が重ならないとき、および他の候補が改善しないときは既定の経路をそのまま返す
 * （再計算のたびに経路が不必要に変わらないようにする）。すべての交差を除去する保証はしない。
 */
export function autoRouteBars(
  from: Point,
  fromEdge: EdgeSide,
  to: Point,
  toEdge: EdgeSide,
  obstacles: readonly RectMm[] = [],
): Bar[] {
  const p1 = stepOutward(from, fromEdge, DIST_PORT_MM);
  const p2 = stepOutward(to, toEdge, DIST_PORT_MM);
  const firstIsVertical = fromEdge === "TOP" || fromEdge === "BOTTOM";
  const corner: Point = firstIsVertical ? { x: p1.x, y: p2.y } : { x: p2.x, y: p1.y };
  const preferred: Point[] = [from, p1, corner, p2, to];

  const baseline = collisionCount(preferred, obstacles);
  if (baseline === 0) return barsOf(preferred);

  const otherCorner: Point = firstIsVertical ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  const candidates: Point[][] = [[from, p1, otherCorner, p2, to]];
  // コの字: 中間の垂直線（x）または水平線（y）を、2点の中間と、各矩形の外側 DIST_PORT の位置に置く。
  const xs = new Set<number>([alignRound((p1.x + p2.x) / 2)]);
  const ys = new Set<number>([alignRound((p1.y + p2.y) / 2)]);
  for (const rect of obstacles) {
    xs.add(alignRound(rect.x - DIST_PORT_MM));
    xs.add(alignRound(rect.x + rect.width + DIST_PORT_MM));
    ys.add(alignRound(rect.y - DIST_PORT_MM));
    ys.add(alignRound(rect.y + rect.height + DIST_PORT_MM));
  }
  for (const x of xs) candidates.push([from, p1, { x, y: p1.y }, { x, y: p2.y }, p2, to]);
  for (const y of ys) candidates.push([from, p1, { x: p1.x, y }, { x: p2.x, y }, p2, to]);

  let best = preferred;
  let bestCollisions = baseline;
  let bestLength = pathLength(preferred);
  for (const candidate of candidates) {
    const collisions = collisionCount(candidate, obstacles);
    const length = pathLength(candidate);
    if (collisions < bestCollisions || (collisions === bestCollisions && collisions < baseline && length < bestLength)) {
      best = candidate;
      bestCollisions = collisions;
      bestLength = length;
    }
  }
  return barsOf(best);
}

/** 保存済みバー列が現在のポート位置と整合するかを確認する（5.5.1の簡略版）。 */
export function isStoredRouteConsistent(bars: readonly Bar[], from: Point, to: Point): boolean {
  if (bars.length < 2) return false;
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return false;
  const startOk =
    (first.direction === "H" && first.fixed === from.y) || (first.direction === "V" && first.fixed === from.x);
  const endOk = (last.direction === "H" && last.fixed === to.y) || (last.direction === "V" && last.fixed === to.x);
  return startOk && endOk;
}

/** 一致する側の端点だけを差し替える。一致しなければ何もしない（6.4.2の「静かにキャンセル」方針）。 */
function retargetEndpoint(bar: Bar, oldValue: number, newValue: number): Bar {
  if (bar.from === oldValue) return { ...bar, from: newValue };
  if (bar.to === oldValue) return { ...bar, to: newValue };
  return bar;
}

/**
 * 結合バーの移動（内部仕様5.5 MoveJoinBarCommand、外部仕様6.2.2）。
 * 先頭・末尾のバー（ポートへ直接接続する区間）は移動対象外とし、undefinedを返す。
 */
export function moveBarBars(bars: readonly Bar[], barIndex: number, newFixed: number): Bar[] | undefined {
  if (barIndex <= 0 || barIndex >= bars.length - 1) return undefined;
  const bar = bars[barIndex];
  if (!bar) return undefined;

  const oldFixed = bar.fixed;
  const fixed = alignRound(newFixed);
  const next = bars.slice();
  next[barIndex] = { ...bar, fixed };

  const prev = next[barIndex - 1];
  if (prev) next[barIndex - 1] = retargetEndpoint(prev, oldFixed, fixed);

  const after = next[barIndex + 1];
  if (after) next[barIndex + 1] = retargetEndpoint(after, oldFixed, fixed);

  return next;
}

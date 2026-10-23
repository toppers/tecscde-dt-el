// [[TECSCDE-DT-EL内部仕様]] 第5章 — 結合の折れ線経路をモデルから点列へ変換する純粋関数。
// DOM/SVGを知らない。ヒットテスト（`HitTester`）と描画（`JoinRenderer`）の両方から使う。

import type { Cell } from "../model/cell";
import type { Bar, Join } from "../model/join";
import { portPosition } from "../model/geometry";
import type { Point } from "../model/geometry";

/**
 * 結合の折れ点列（外部仕様4.6.2）。始点は呼び口位置、終点は受け口位置。
 * `bars` を明示指定すると `join.bars` の代わりにそれを使う（ドラッグ中プレビュー用）。
 * 呼び口／受け口が両端セルに見つからなければ `undefined`。
 */
export function joinPolyline(
  join: Join,
  source: Cell,
  target: Cell,
  bars: readonly Bar[] = join.bars,
): readonly Point[] | undefined {
  const cport = source.findCPort(join.cportName);
  const eport = target.findEPort(join.eportName);
  if (!cport || !eport) return undefined;

  const points: Point[] = [portPosition(source, cport)];
  for (const bar of bars) {
    points.push(bar.direction === "H" ? { x: bar.to, y: bar.fixed } : { x: bar.fixed, y: bar.to });
  }
  points.push(portPosition(target, eport));
  return points;
}

// --- スタブ（第6B章6B.5）: 一端だけが非表示リージョンのセルに属する結合 ---

/** スタブの長さ(mm)。暫定値（6B.5、実機で見て決める）。 */
export const STUB_LEN_MM = 4;
/** スタブの先端に添える横線の全長(mm)。暫定値。 */
export const STUB_TICK_MM = 2;

/** 折れ線の先頭から長さ `lengthMm` までを切り出す。全長より長ければ全体を返す。 */
export function truncatePolyline(points: readonly Point[], lengthMm: number): Point[] {
  const first = points[0];
  if (!first) return [];
  const out: Point[] = [first];
  let remaining = lengthMm;
  for (let i = 0; i + 1 < points.length && remaining > 0; i += 1) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment <= remaining) {
      out.push(b);
      remaining -= segment;
    } else {
      const t = remaining / segment;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      remaining = 0;
    }
  }
  return out;
}

/** スタブ先端の横線の両端。最後の線分に直交し、先端を中心とする。 */
export function stubTick(stub: readonly Point[], tickMm: number = STUB_TICK_MM): [Point, Point] {
  const end = stub[stub.length - 1] as Point;
  const prev = (stub[stub.length - 2] ?? end) as Point;
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const len = Math.hypot(dx, dy);
  const half = tickMm / 2;
  // 方向が定まらない（長さ0）ときは水平の横線にする。
  const nx = len === 0 ? 0 : -dy / len;
  const ny = len === 0 ? 1 : dx / len;
  return [
    { x: end.x + nx * half, y: end.y + ny * half },
    { x: end.x - nx * half, y: end.y - ny * half },
  ];
}

export interface JoinVisibleParts {
  readonly points: readonly Point[];
  /** `points` の各線分が、元の折れ線の何番目の線分か（ヒットテストが元の結合バー番号へ戻すため）。 */
  readonly segmentIndices: readonly number[];
  readonly isStub: boolean;
}

/**
 * 両端の可視状態から、実際に描く部分を決める。両端が可視なら全体、片方だけ非表示ならその反対側
 * （可視側）の端点から `STUB_LEN_MM` だけ、両端が非表示なら `undefined`（完全に消す）。
 */
export function joinStub(
  points: readonly Point[],
  sourceHidden: boolean,
  targetHidden: boolean,
): JoinVisibleParts | undefined {
  const segmentCount = Math.max(0, points.length - 1);
  if (sourceHidden && targetHidden) return undefined;
  if (!sourceHidden && !targetHidden) {
    return { points, segmentIndices: Array.from({ length: segmentCount }, (_, i) => i), isStub: false };
  }
  // 呼び口側（始点）が非表示なら、受け口側（終点）から伸ばすために向きを反転する。
  const oriented = sourceHidden ? [...points].reverse() : [...points];
  const stub = truncatePolyline(oriented, STUB_LEN_MM);
  const stubSegments = Math.max(0, stub.length - 1);
  const segmentIndices = Array.from({ length: stubSegments }, (_, j) =>
    sourceHidden ? segmentCount - 1 - j : j,
  );
  return { points: stub, segmentIndices, isStub: true };
}

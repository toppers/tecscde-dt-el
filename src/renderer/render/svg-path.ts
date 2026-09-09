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

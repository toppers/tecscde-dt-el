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

/**
 * 呼び口・受け口の位置から自動的に折れ線経路を生成する（外部仕様4.6.2）。
 * 水平・垂直の線分のみで構成し、ポートから DIST_PORT 分の距離を確保する。
 */
export function autoRouteBars(from: Point, fromEdge: EdgeSide, to: Point, toEdge: EdgeSide): Bar[] {
  const p1 = stepOutward(from, fromEdge, DIST_PORT_MM);
  const p2 = stepOutward(to, toEdge, DIST_PORT_MM);
  const firstIsVertical = fromEdge === "TOP" || fromEdge === "BOTTOM";
  const corner: Point = firstIsVertical ? { x: p1.x, y: p2.y } : { x: p2.x, y: p1.y };

  const bars: Bar[] = [];
  const push = (b: Bar | undefined): void => {
    if (b) bars.push(b);
  };
  push(segment(from, p1));
  push(segment(p1, corner));
  push(segment(corner, p2));
  push(segment(p2, to));
  return bars;
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

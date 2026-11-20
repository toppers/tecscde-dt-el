// 外部仕様5.3.x（2026-11-03）— レイアウトを持たないセルの自動配置。
// 従来の格子（座標 (10, 10) を起点に横 55 mm・縦 30 mm 刻み）の順に走査し、すでに置かれたセル
// （保存済みの位置を持つセルを含む）と重ならない最初の位置に置く。用紙の内に空きが無くなったセルは、
// 格子を先頭から走査し直し、横 8 mm・縦 6 mm ずつずらして置く（重なるが、下のセルがはみ出して見える）。
// 用紙の外には置かない。

import { PaperSpec, type PaperSize } from "../model/paper";

export interface CellSize {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AutoPlacement {
  readonly positions: readonly { readonly x: number; readonly y: number }[];
  /** 用紙の内に空きが無く、ずらして重ねて置いたセルの数。 */
  readonly overflow: number;
}

export const AUTO_CELL_WIDTH = 25;
export const AUTO_CELL_HEIGHT = 15;

const START = 10;
const COLUMN_STEP = 55;
const ROW_STEP = 30;
const SHIFT_X = 8;
const SHIFT_Y = 6;
/** 走査し直す回数の上限。用紙が極端に小さいときに、無限に続けないため。 */
const MAX_PASSES = 40;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 従来の格子の位置（ずれ無し）。セルの実寸（幅・高さ）が用紙内に収まる候補を列挙する。 */
function gridPositionsForSize(paperW: number, paperH: number, cellW: number, cellH: number): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let y = START; y + cellH <= paperH; y += ROW_STEP) {
    for (let x = START; x + cellW <= paperW; x += COLUMN_STEP) result.push({ x, y });
  }
  return result;
}

/** 自動選択の候補。向きは横のみ（外部仕様5.3.x）。小さい順。 */
const AUTO_PAPER_SIZES: readonly PaperSize[] = ["A4", "A3", "A2"];

/**
 * 用紙の指定がないファイルの用紙を選ぶ（外部仕様5.3.x）。自動配置するセル `targets` が、`occupied`
 * （すでに位置を持つセル）と合わせて、重ならず用紙の内に収まる最小の用紙（A4横 → A3横 → A2横）。
 * A2横でも収まらないときは A2 を返す（収まらなかったセルは、読み込み時の警告で知らせる）。
 */
export function chooseAutoPaperSize(targets: number | readonly CellSize[], occupied: readonly Rect[]): PaperSize {
  for (const size of AUTO_PAPER_SIZES) {
    const { width, height } = PaperSpec.create(size, "LANDSCAPE").contentSize();
    const containsAll = occupied.every((r) => r.x + r.width <= width && r.y + r.height <= height);
    if (containsAll && placeAutoCells(targets, occupied, width, height).overflow === 0) return size;
  }
  return "A2";
}

export function placeAutoCells(
  targets: number | readonly CellSize[],
  occupied: readonly Rect[],
  paperW: number,
  paperH: number,
): AutoPlacement {
  const sizes: readonly CellSize[] =
    typeof targets === "number"
      ? Array.from({ length: targets }, () => ({ width: AUTO_CELL_WIDTH, height: AUTO_CELL_HEIGHT }))
      : targets;
  const placed: Rect[] = [...occupied];
  const positions: { x: number; y: number }[] = [];
  let overflow = 0;

  // 2周目以降（ずらし配置）のカーソル。同じ用紙サイズ内で順にずらす。
  let pass = 1;
  let overflowCursor = 0;

  for (const size of sizes) {
    const grid = gridPositionsForSize(paperW, paperH, size.width, size.height);
    let position: { x: number; y: number } | undefined;

    // 1周目: セルの実寸で用紙内に収まり、既存セルと重ならない最初の候補を選ぶ（三者相違一覧 6-8）。
    for (const candidate of grid) {
      const box: Rect = { ...candidate, width: size.width, height: size.height };
      if (!placed.some((other) => overlaps(box, other))) {
        position = candidate;
        break;
      }
    }

    if (position === undefined) {
      overflow += 1;
      const overflowGrid = grid.length > 0 ? grid : [{ x: START, y: START }];
      while (position === undefined && pass <= MAX_PASSES) {
        if (overflowCursor >= overflowGrid.length) {
          pass += 1;
          overflowCursor = 0;
          continue;
        }
        const base = overflowGrid[overflowCursor]!;
        overflowCursor += 1;
        const candidate = { x: base.x + SHIFT_X * pass, y: base.y + SHIFT_Y * pass };
        if (candidate.x + size.width <= paperW && candidate.y + size.height <= paperH) position = candidate;
      }
      position ??= { x: START, y: START }; // 用紙が極端に小さいとき
    }

    positions.push(position);
    placed.push({ ...position, width: size.width, height: size.height });
  }
  return { positions, overflow };
}

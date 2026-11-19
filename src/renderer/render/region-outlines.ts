// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.5節 — リージョン矩形モード `computeRegionOutlines`。
//
// 根を除く各リージョンについて、表示中でその部分木に属するセルの矩形の和集合を
// 座標圧縮した格子で求め、外部と接する辺（外周線分）と名前表示位置を導出する（三者相違一覧3-1・監査#47）。

import type { TecscdeDocument } from "../model/document";
import type { CellId, RegionId } from "../model/ids";
import { ROOT_REGION_ID } from "../model/ids";
import type { Point } from "../model/geometry";
import type { Region, RegionTree } from "../model/region";

export interface LineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface RegionOutline {
  readonly regionId: RegionId;
  readonly regionName: string;
  readonly color: string;
  readonly segments: readonly LineSegment[];
  readonly labelPos: Point;
  readonly depth: number;
}

interface Box {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function regionTreeHeight(region: Region): number {
  if (region.children.length === 0) return 0;
  return 1 + Math.max(...region.children.map(regionTreeHeight));
}

function collectDescendantCells(
  doc: TecscdeDocument,
  region: Region,
  visibleCellIds: ReadonlySet<CellId>,
): CellId[] {
  const result: CellId[] = [];
  const walk = (r: Region): void => {
    for (const cellId of r.cellIds) {
      if (visibleCellIds.has(cellId)) {
        const cell = doc.getCell(cellId);
        if (cell) result.push(cellId);
      }
    }
    for (const child of r.children) walk(child);
  };
  walk(region);
  return result;
}

/** 矩形の集合から座標圧縮格子で和集合を求め、外周線分（隣接する同一直線辺は結合）と左上ラベル位置を返す。 */
function computeUnionOutline(boxes: readonly Box[]): { segments: LineSegment[]; labelPos: Point } {
  const xs = [...new Set(boxes.flatMap((b) => [b.x1, b.x2]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap((b) => [b.y1, b.y2]))].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;

  const filled: boolean[][] = Array.from({ length: nx }, () => Array<boolean>(ny).fill(false));
  for (const b of boxes) {
    for (let ix = 0; ix < nx; ix += 1) {
      if (xs[ix]! >= b.x1 && xs[ix + 1]! <= b.x2) {
        for (let iy = 0; iy < ny; iy += 1) {
          if (ys[iy]! >= b.y1 && ys[iy + 1]! <= b.y2) {
            filled[ix]![iy] = true;
          }
        }
      }
    }
  }

  const segments: LineSegment[] = [];

  // 水平境界辺（上下の充填状態が異なる格子辺）を抽出し、同一直線・同向きの連続辺を結合
  for (let iy = 0; iy <= ny; iy += 1) {
    let runStart: number | null = null;
    let runDir = 0;
    const flush = (endIx: number): void => {
      if (runStart !== null) {
        segments.push({ x1: xs[runStart]!, y1: ys[iy]!, x2: xs[endIx]!, y2: ys[iy]! });
        runStart = null;
        runDir = 0;
      }
    };
    for (let ix = 0; ix < nx; ix += 1) {
      const above = iy > 0 && filled[ix]![iy - 1]!;
      const below = iy < ny && filled[ix]![iy]!;
      const dir = above === below ? 0 : below ? 1 : -1;
      if (dir === 0) {
        flush(ix);
      } else if (dir !== runDir) {
        flush(ix);
        runStart = ix;
        runDir = dir;
      }
    }
    flush(nx);
  }

  // 垂直境界辺（左右の充填状態が異なる格子辺）を抽出し、同一直線・同向きの連続辺を結合
  for (let ix = 0; ix <= nx; ix += 1) {
    let runStart: number | null = null;
    let runDir = 0;
    const flush = (endIy: number): void => {
      if (runStart !== null) {
        segments.push({ x1: xs[ix]!, y1: ys[runStart]!, x2: xs[ix]!, y2: ys[endIy]! });
        runStart = null;
        runDir = 0;
      }
    };
    for (let iy = 0; iy < ny; iy += 1) {
      const left = ix > 0 && filled[ix - 1]![iy]!;
      const right = ix < nx && filled[ix]![iy]!;
      const dir = left === right ? 0 : right ? 1 : -1;
      if (dir === 0) {
        flush(iy);
      } else if (dir !== runDir) {
        flush(iy);
        runStart = iy;
        runDir = dir;
      }
    }
    flush(ny);
  }

  // ラベル位置: 最上段の最小 y のうち最も左の充填セルの左上角
  let labelPos: Point = { x: xs[0]!, y: ys[0]! };
  outer: for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      if (filled[ix]![iy]) {
        labelPos = { x: xs[ix]!, y: ys[iy]! };
        break outer;
      }
    }
  }

  return { segments, labelPos };
}

export function computeRegionOutlines(
  doc: TecscdeDocument,
  visibleCellIds: ReadonlySet<CellId>,
  regionTree: RegionTree,
  colorMap: ReadonlyMap<RegionId, string>,
): readonly RegionOutline[] {
  const outlines: RegionOutline[] = [];

  const visit = (region: Region, depth: number): void => {
    if (region.id !== ROOT_REGION_ID) {
      const cellIds = collectDescendantCells(doc, region, visibleCellIds);
      if (cellIds.length > 0) {
        const height = regionTreeHeight(region);
        const margin = 1 + 1 * height; // mm

        const boxes: Box[] = cellIds.map((cid) => {
          const cell = doc.getCell(cid)!;
          return {
            x1: cell.x - margin,
            y1: cell.y - margin,
            x2: cell.x + cell.width + margin,
            y2: cell.y + cell.height + margin,
          };
        });

        const { segments, labelPos } = computeUnionOutline(boxes);
        const color = colorMap.get(region.id) ?? "#888888";
        const regionName = region.namespacePath.split("::").filter(Boolean).pop() || region.namespacePath;
        outlines.push({
          regionId: region.id,
          regionName,
          color,
          segments,
          labelPos,
          depth,
        });
      }
    }

    for (const child of region.children) {
      visit(child, depth + 1);
    }
  };

  visit(regionTree.root, 0);

  // 浅い順（親が先、子が後）に整列
  return outlines.sort((a, b) => a.depth - b.depth || a.regionId.localeCompare(b.regionId));
}

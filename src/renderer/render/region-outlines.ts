// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.5節 — リージョン矩形モード `computeRegionOutlines`。
//
// 根を除く各リージョンについて、表示中でその部分木に属するセルの外周線分と名前表示位置を導出する。

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

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const cid of cellIds) {
          const cell = doc.getCell(cid)!;
          minX = Math.min(minX, cell.x);
          minY = Math.min(minY, cell.y);
          maxX = Math.max(maxX, cell.x + cell.width);
          maxY = Math.max(maxY, cell.y + cell.height);
        }

        minX -= margin;
        minY -= margin;
        maxX += margin;
        maxY += margin;

        const color = colorMap.get(region.id) ?? "#888888";
        const segments: LineSegment[] = [
          { x1: minX, y1: minY, x2: maxX, y2: minY },
          { x1: maxX, y1: minY, x2: maxX, y2: maxY },
          { x1: maxX, y1: maxY, x2: minX, y2: maxY },
          { x1: minX, y1: maxY, x2: minX, y2: minY },
        ];

        const regionName = region.namespacePath.split("::").filter(Boolean).pop() || region.namespacePath;
        outlines.push({
          regionId: region.id,
          regionName,
          color,
          segments,
          labelPos: { x: minX, y: minY },
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

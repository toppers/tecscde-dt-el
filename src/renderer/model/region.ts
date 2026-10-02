// TECSCDE-TS内部仕様 3.2 — Region/RegionTree。Compositeパターン（外部仕様4.9）。

import { ROOT_REGION_ID, type CellId, type RegionId } from "./ids";

export class Region {
  private constructor(
    readonly id: RegionId,
    readonly namespacePath: string, // "::" 区切り、根は "::"（外部仕様4.8.1）
    readonly children: readonly Region[],
    readonly cellIds: readonly CellId[],
  ) {}

  static create(
    id: RegionId,
    namespacePath: string,
    children: readonly Region[] = [],
    cellIds: readonly CellId[] = [],
  ): Region {
    return new Region(id, namespacePath, children, cellIds);
  }

  addCell(cellId: CellId): Region {
    return new Region(this.id, this.namespacePath, this.children, [...this.cellIds, cellId]);
  }

  withChildrenAndCells(children: readonly Region[], cellIds: readonly CellId[]): Region {
    return new Region(this.id, this.namespacePath, children, cellIds);
  }

  findById(id: RegionId): Region | undefined {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.findById(id);
      if (found) return found;
    }
    return undefined;
  }
}

export class RegionTree {
  private constructor(readonly root: Region) {}

  static empty(): RegionTree {
    return new RegionTree(Region.create(ROOT_REGION_ID, "::"));
  }

  static of(root: Region): RegionTree {
    return new RegionTree(root);
  }

  findById(id: RegionId): Region | undefined {
    return this.root.findById(id);
  }

  /** Keep the reverse membership index in sync with Cell.regionId. */
  assignCell(cellId: CellId, regionId: RegionId): RegionTree {
    if (!this.findById(regionId)) return this;
    const visit = (region: Region): Region => {
      const children = region.children.map(visit);
      const cellIds = region.cellIds.filter((id) => id !== cellId);
      if (region.id === regionId) cellIds.push(cellId);
      return region.withChildrenAndCells(children, cellIds);
    };
    return new RegionTree(visit(this.root));
  }

  removeCell(cellId: CellId): RegionTree {
    const visit = (region: Region): Region => region.withChildrenAndCells(
      region.children.map(visit),
      region.cellIds.filter((id) => id !== cellId),
    );
    return new RegionTree(visit(this.root));
  }
}

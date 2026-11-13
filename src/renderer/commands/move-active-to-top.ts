import { Command } from "./command";
import type { TecscdeDocument } from "../model/document";
import type { Cell } from "../model/cell";
import type { CellId, JoinId } from "../model/ids";
import type { Bar } from "../model/join";
import { autoRouteBars, portPosition, type Point, type RectMm } from "../model/geometry";
import { isActiveCell } from "../render/cell-visibility";

export interface ActiveTopMove {
  readonly cellId: CellId;
  readonly from: Point;
  readonly to: Point;
}
export interface ActiveTopJoinRoute {
  readonly joinId: JoinId;
  readonly before: readonly Bar[];
  readonly after: readonly Bar[];
}
export interface ActiveTopPlan {
  readonly kind: "ready" | "unchanged" | "empty" | "failed";
  readonly reason?: string;
  readonly orderedCellIds: readonly CellId[];
  readonly moves: readonly ActiveTopMove[];
  readonly joinRoutes: readonly ActiveTopJoinRoute[];
  readonly topRowCellIds: readonly CellId[];
  readonly spilledCellIds: readonly CellId[];
  /** Values, never object references or history depth. */
  readonly precondition: string;
}

const barsSnapshot = (bars: readonly Bar[]): readonly Bar[] => Object.freeze(bars.map((bar) => Object.freeze({
  direction: bar.direction, fixed: bar.fixed, from: bar.from, to: bar.to,
})));

function freezePlan(plan: ActiveTopPlan): ActiveTopPlan {
  return Object.freeze({ ...plan,
    orderedCellIds: Object.freeze([...plan.orderedCellIds]),
    topRowCellIds: Object.freeze([...plan.topRowCellIds]),
    spilledCellIds: Object.freeze([...plan.spilledCellIds]),
    moves: Object.freeze(plan.moves.map((move) => Object.freeze({ ...move,
      from: Object.freeze({ ...move.from }), to: Object.freeze({ ...move.to }),
    }))),
    joinRoutes: Object.freeze(plan.joinRoutes.map((route) => Object.freeze({ ...route,
      before: barsSnapshot(route.before), after: barsSnapshot(route.after),
    }))),
  });
}

function layoutState(doc: TecscdeDocument): string {
  return JSON.stringify({ paper: { size: doc.paper.size, orientation: doc.paper.orientation },
    cells: doc.cellValues().map((cell) => ({ id: cell.id, x: cell.x, y: cell.y, width: cell.width, height: cell.height,
      editable: cell.editable, locale: cell.locale, regionId: cell.regionId, active: isActiveCell(doc, cell),
      ports: [...cell.cports, ...cell.eports].map((port) => ({ name: port.name, signature: port.signature,
        edge: port.edgeSide, offset: port.offset, subscript: port.subscript, arraySize: port.arraySize })),
    })),
    joins: doc.joinValues().map((join) => ({ id: join.id, cellId: join.cellId, cportName: join.cportName,
      eportCellId: join.eportCellId, eportName: join.eportName,
      bars: join.bars.map((bar) => ({ direction: bar.direction, fixed: bar.fixed, from: bar.from, to: bar.to })),
    })),
  });
}

export function canMoveActiveToTop(doc: TecscdeDocument): boolean {
  return doc.cellValues().some((cell) => cell.editable && isActiveCell(doc, cell));
}

const overlaps = (left: RectMm, right: RectMm): boolean => left.x < right.x + right.width &&
  left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const sameBars = (left: readonly Bar[], right: readonly Bar[]): boolean => left.length === right.length &&
  left.every((bar, index) => { const other = right[index]!; return bar.direction === other.direction &&
    bar.fixed === other.fixed && bar.from === other.from && bar.to === other.to; });

/** 06C.4: finite 4G grid, no overlap/offset fallback and no store/selection/filter access. */
export function prepareMoveActiveToTop(doc: TecscdeDocument): ActiveTopPlan {
  const targets = doc.cellValues().filter((cell) => cell.editable && isActiveCell(doc, cell));
  const base = { orderedCellIds: targets.map((cell) => cell.id), precondition: layoutState(doc),
    moves: [] as readonly ActiveTopMove[], joinRoutes: [] as readonly ActiveTopJoinRoute[],
    topRowCellIds: [] as readonly CellId[], spilledCellIds: [] as readonly CellId[] };
  const failed = (reason: string): ActiveTopPlan => freezePlan({ ...base, kind: "failed", reason });
  if (targets.length === 0) return freezePlan({ ...base, kind: "empty", reason: "編集できるアクティブなセルがありません" });
  if (doc.cellValues().some((cell) => ![cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) || cell.width <= 0 || cell.height <= 0)) {
    return failed("セルの位置または寸法が不正なため、移動を行いませんでした。");
  }
  const { width, height } = doc.paper.contentSize();
  const targetIds = new Set(targets.map((cell) => cell.id));
  const occupied: RectMm[] = doc.cellValues().filter((cell) => !targetIds.has(cell.id));
  const moves: ActiveTopMove[] = [];
  const topRowCellIds: CellId[] = [], spilledCellIds: CellId[] = [];
  let final = doc;
  for (const cell of targets) {
    let position: Point | undefined;
    for (let y = 10; y + cell.height <= height && !position; y += 30) {
      for (let x = 10; x <= width - 30 && x + cell.width <= width; x += 55) {
        const rect = { x, y, width: cell.width, height: cell.height };
        if (!occupied.some((obstacle) => overlaps(rect, obstacle))) { position = { x, y }; break; }
      }
    }
    if (!position) return failed("現在の用紙内に重ならず配置できないため、アクティブなセルの移動を行いませんでした。");
    occupied.push({ ...position, width: cell.width, height: cell.height });
    (position.y === 10 ? topRowCellIds : spilledCellIds).push(cell.id);
    if (position.x !== cell.x || position.y !== cell.y) {
      moves.push({ cellId: cell.id, from: { x: cell.x, y: cell.y }, to: position });
      final = final.withCell(cell.moveTo(position.x, position.y));
    }
  }
  const movedIds = new Set(moves.map((move) => move.cellId));
  const joinRoutes: ActiveTopJoinRoute[] = [];
  for (const join of doc.joinValues()) {
    if (!movedIds.has(join.cellId) && !movedIds.has(join.eportCellId)) continue;
    const source = final.getCell(join.cellId), target = final.getCell(join.eportCellId);
    const cport = source?.findCPort(join.cportName), eport = target?.findEPort(join.eportName);
    if (!source || !target || !cport || !eport) return failed("結合の端点が見つからないため、アクティブなセルの移動を行いませんでした。");
    const after = autoRouteBars(portPosition(source, cport), cport.edgeSide, portPosition(target, eport), eport.edgeSide, final.cellValues());
    if (!sameBars(join.bars, after)) joinRoutes.push({ joinId: join.id, before: join.bars, after });
  }
  return freezePlan({ ...base, kind: moves.length || joinRoutes.length ? "ready" : "unchanged",
    moves, joinRoutes, topRowCellIds, spilledCellIds });
}

export class MoveActiveCellsToTopCommand extends Command {
  readonly kind = "MoveActiveCellsToTop";
  readonly plan: ActiveTopPlan;
  override readonly summary: string;
  constructor(plan: ActiveTopPlan) {
    super();
    this.plan = freezePlan(plan);
    this.summary = `move ${plan.moves.length} active cell(s) to top`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    if (this.plan.kind !== "ready" || layoutState(doc) !== this.plan.precondition) return doc;
    let next = doc;
    for (const move of this.plan.moves) {
      const cell: Cell = next.getCell(move.cellId)!;
      next = next.withCell(cell.moveTo(move.to.x, move.to.y));
    }
    for (const route of this.plan.joinRoutes) {
      const join = next.getJoin(route.joinId)!;
      next = next.withJoin(join.withBars(route.after));
    }
    return next;
  }
}

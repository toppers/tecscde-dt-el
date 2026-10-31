// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — ポート位置に関するコマンドクラス（外部仕様4.3.2踏襲）。
//
// MovePort/ChangePortEdge を分離するのは、モデル層 不変条件#3「ポートは所属辺上のオフセットのみ
// 変更可能（辺の変更は別操作）」に対応するため。MovePort は辺を保ったままオフセットだけを
// クランプ・変更し、ChangePortEdge は辺そのものの変更を明示的な操作として扱う（移動先の辺の
// 長さでオフセットを再クランプするため別バリデーションが要る）。

import { Command } from "./command";
import { disconnectJoin, rerouteJoin } from "./support";
import { alignRound } from "../model/align";
import type { Cell } from "../model/cell";
import type { CellId, JoinId } from "../model/ids";
import { CPort, EPort, type EdgeSide } from "../model/port";
import type { TecscdeDocument } from "../model/document";

export type PortKind = "CPort" | "EPort";

function edgeLength(cell: Cell, edge: EdgeSide): number {
  return edge === "TOP" || edge === "BOTTOM" ? cell.width : cell.height;
}

/** 辺の範囲内（0〜辺の長さ）にオフセットを収め、ALIGN格子へ丸める。 */
function clampOffset(cell: Cell, edge: EdgeSide, offset: number): number {
  return Math.max(0, Math.min(edgeLength(cell, edge), alignRound(offset)));
}

/** 配列ポートの要素を挿入するとき、隣り合うポートの間に空ける間隔（mm）。元の実装(Ruby版)の `DIST_PORT`。 */
const INSERT_PORT_GAP_MM = 4;
/** 辺の端まで押し込まれても、これより近づけない間隔（mm）。辺に収まる範囲でのみ守る。 */
const MIN_PORT_GAP_MM = 3;

/**
 * 挿入する要素の位置と、場所を空けるための同じ辺のポートの移動先を決める。
 * 元の実装(Ruby版 `TmCell#adjust_port_position_to_insert`)に合わせる:
 * 後ろへの挿入では新しい要素を基準の `GAP` 先に置き、次のポートまでが `GAP*2` に満たなければ、
 * それより後ろのポートを同じ辺で後ろへずらして間隔を確保する。前への挿入は基準の位置に
 * 新しい要素を置き、基準以降のポートを `GAP` ずつ後ろへずらす。
 * 辺の端を超える分は、端から `MIN_PORT_GAP_MM` 間隔で詰める（辺に収まらない数のときは重なる）。
 */
function planInsertPosition(
  cell: Cell,
  edge: EdgeSide,
  anchor: number,
  before: boolean,
): { newOffset: number; offsets: ReadonlyMap<CPort | EPort, number> } {
  const onEdge = [...cell.cports, ...cell.eports].filter((p) => p.edgeSide === edge);
  let newProposed: number;
  let push: number;
  if (before) {
    newProposed = anchor;
    push = INSERT_PORT_GAP_MM;
  } else {
    const next = Math.min(...onEdge.map((p) => p.offset).filter((offset) => offset > anchor));
    newProposed = anchor + INSERT_PORT_GAP_MM;
    push = Number.isFinite(next) ? Math.max(0, INSERT_PORT_GAP_MM * 2 - (next - anchor)) : 0;
  }
  // 端に詰める順序が入れ替わらないよう、同じ位置に押し込まれたものは元の位置と添字で順序を決める。
  const items = [
    { port: null as CPort | EPort | null, offset: clampOffset(cell, edge, newProposed), origin: before ? anchor - 0.5 : anchor + 0.5, subscript: -2, moves: true },
    ...onEdge.map((port) => {
      const moves = before ? port.offset >= anchor : port.offset > anchor;
      return {
        port: port as CPort | EPort | null,
        offset: moves ? clampOffset(cell, edge, port.offset + push) : port.offset,
        origin: port.offset,
        subscript: port.subscript ?? -1,
        moves,
      };
    }),
  ];
  items.sort((x, y) => y.offset - x.offset || y.origin - x.origin || y.subscript - x.subscript);
  // 端側から順に、動かしたもの（と、それに詰められたもの）が MIN_PORT_GAP_MM 以内に近づかないよう押し戻す。
  let limit = edgeLength(cell, edge);
  for (const item of items) {
    const bounded = Math.max(0, Math.min(item.offset, limit));
    const squeezed = bounded < item.offset;
    item.offset = bounded;
    limit = item.moves || squeezed ? bounded - MIN_PORT_GAP_MM : Number.POSITIVE_INFINITY;
  }
  const created = items.find((item) => item.port === null)!;
  const offsets = new Map<CPort | EPort, number>();
  for (const item of items) if (item.port && item.offset !== item.port.offset) offsets.set(item.port, item.offset);
  return { newOffset: created.offset, offsets };
}

function joinIdsOfCPort(port: CPort): readonly JoinId[] {
  return port.joinId ? [port.joinId] : [];
}

function reroutePortJoins(doc: TecscdeDocument, joinIds: readonly JoinId[]): TecscdeDocument {
  let next = doc;
  for (const jid of joinIds) next = rerouteJoin(next, jid);
  return next;
}

/**
 * 外部仕様4.3.2: ポートは所属辺内のオフセットのみ変更する（辺をまたぐ移動は ChangePortEdge）。
 * 読み込み専用セル・存在しないポートに対しては何もしない。接続済みの結合は経路を再計算する。
 */
export class MovePortCommand extends Command {
  readonly kind = "MovePort";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly newOffset: number,
    private readonly subscript?: number | null,
  ) {
    super();
    this.summary = `move port ${portName}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable || !Number.isFinite(this.newOffset)) return doc;

    if (this.portKind === "CPort") {
      const port = cell.findCPort(this.portName, this.subscript);
      if (!port) return doc;
      const moved = port.withEdge(port.edgeSide, clampOffset(cell, port.edgeSide, this.newOffset));
      if (moved.offset === port.offset) return doc;
      const next = doc.withCell(cell.withCPort(moved));
      return reroutePortJoins(next, joinIdsOfCPort(port));
    }

    const port = cell.findEPort(this.portName, this.subscript);
    if (!port) return doc;
    const moved = port.withEdge(port.edgeSide, clampOffset(cell, port.edgeSide, this.newOffset));
    if (moved.offset === port.offset) return doc;
    const next = doc.withCell(cell.withEPort(moved));
    return reroutePortJoins(next, port.joinIds);
  }
}

/**
 * 外部仕様4.3.2: 辺をまたぐ変更を明示的な操作として分離する。移動先の辺と、その辺上での
 * 新オフセットを同時に確定する。接続済みの結合は経路を再計算する。
 */
export class ChangePortEdgeCommand extends Command {
  readonly kind = "ChangePortEdge";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly newEdge: EdgeSide,
    private readonly newOffset: number,
    private readonly subscript?: number | null,
  ) {
    super();
    this.summary = `move port ${portName} to ${newEdge}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable || !Number.isFinite(this.newOffset)) return doc;
    const offset = clampOffset(cell, this.newEdge, this.newOffset);

    if (this.portKind === "CPort") {
      const port = cell.findCPort(this.portName, this.subscript);
      if (!port) return doc;
      if (port.edgeSide === this.newEdge && port.offset === offset) return doc;
      const next = doc.withCell(cell.withCPort(port.withEdge(this.newEdge, offset)));
      return reroutePortJoins(next, joinIdsOfCPort(port));
    }

    const port = cell.findEPort(this.portName, this.subscript);
    if (!port) return doc;
    if (port.edgeSide === this.newEdge && port.offset === offset) return doc;
    const next = doc.withCell(cell.withEPort(port.withEdge(this.newEdge, offset)));
    return reroutePortJoins(next, port.joinIds);
  }
}

/** 同じ操作で選択ポートをまとめて動かし、Undo単位を一つにする。 */
export class MovePortsCommand extends Command {
  readonly kind = "MovePorts";
  constructor(
    private readonly moves: readonly {
      cellId: CellId;
      kind: PortKind;
      name: string;
      subscript: number | null;
      offset: number;
    }[],
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    return this.moves.reduce(
      (next, move) => new MovePortCommand(move.cellId, move.kind, move.name, move.offset, move.subscript).apply(next),
      doc,
    );
  }
}

/**
 * 外部仕様6.1.1・6.1.2: 配列ポート（可変長）要素の挿入（Insertキー / Shift+Insertキー）。
 * before が真（Shift+Insert）なら選択要素の前、偽（Insert）なら後ろに挿入する。
 * 固定長配列や非配列ポートに対しては何もしない（呼び出し側でメッセージ通知）。
 */
export class InsertPortElementCommand extends Command {
  readonly kind = "InsertPortElement";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly subscript: number,
    private readonly before: boolean = false,
  ) {
    super();
    this.summary = `insert port element ${portName} ${before ? "before" : "after"} [${subscript}]`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;

    const insertIndex = this.before ? this.subscript : this.subscript + 1;
    const target =
      this.portKind === "CPort"
        ? cell.findCPort(this.portName, this.subscript)
        : cell.findEPort(this.portName, this.subscript);
    if (!target || target.subscript === null || target.arraySize !== null) return doc;

    const plan = planInsertPosition(cell, target.edgeSide, target.offset, this.before);
    const movedJoinIds: JoinId[] = [];

    // 添字の繰り上げと、場所を空けるための同じ辺のポートの移動を一度に行う。
    const adjust = <P extends CPort | EPort>(port: P): P => {
      let next: P = port;
      if (port.name === this.portName && port.subscript !== null && port.subscript >= insertIndex) {
        next = next.withSubscript(port.subscript + 1) as P;
      }
      if (port.edgeSide === target.edgeSide) {
        const offset = plan.offsets.get(port) ?? port.offset;
        if (offset !== port.offset) {
          next = next.withEdge(port.edgeSide, offset) as P;
          movedJoinIds.push(...(port instanceof CPort ? joinIdsOfCPort(port) : port.joinIds));
        }
      }
      return next;
    };
    const insertAt = <P extends CPort | EPort>(list: P[], created: P): P[] => {
      const pos = list.findIndex(
        (p) => p.name === this.portName && p.subscript !== null && p.subscript > insertIndex,
      );
      if (pos >= 0) list.splice(pos, 0, created);
      else list.push(created);
      return list;
    };
    const newOffset = plan.newOffset;

    let next: TecscdeDocument;
    if (this.portKind === "CPort") {
      const created = CPort.create({
        name: target.name,
        signature: target.signature,
        edgeSide: target.edgeSide,
        offset: newOffset,
        subscript: insertIndex,
        arraySize: null,
      });
      next = doc.withCell(cell.withEPorts(cell.eports.map(adjust)).withCPorts(insertAt(cell.cports.map(adjust), created)));
    } else {
      const created = EPort.create({
        name: target.name,
        signature: target.signature,
        edgeSide: target.edgeSide,
        offset: newOffset,
        subscript: insertIndex,
        arraySize: null,
      });
      next = doc.withCell(cell.withCPorts(cell.cports.map(adjust)).withEPorts(insertAt(cell.eports.map(adjust), created)));
    }
    return reroutePortJoins(next, movedJoinIds);
  }
}

/**
 * 外部仕様6.3.1・6.3.2: 配列ポート（可変長）要素の削除（Deleteキー）。
 * 添字0の要素（subscript === 0）および固定長配列は削除できない（呼び出し側でメッセージ通知）。
 * 削除された要素に接続されていた結合はカスケード削除され、後続要素の添字は -1 される。
 */
export class DeletePortElementCommand extends Command {
  readonly kind = "DeletePortElement";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly subscript: number,
  ) {
    super();
    this.summary = `delete port element ${portName}[${subscript}]`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;

    // 添字0は削除不可（仕様6.3.1）
    if (this.subscript === 0) return doc;

    let next = doc;

    if (this.portKind === "CPort") {
      const target = cell.findCPort(this.portName, this.subscript);
      if (!target || target.subscript === null || target.arraySize !== null) return doc;

      if (target.joinId) {
        next = disconnectJoin(next, target.joinId);
      }
      const refreshedCell = next.getCell(this.cellId)!;

      const updatedCPorts: CPort[] = [];
      for (const p of refreshedCell.cports) {
        if (p.name === this.portName && p.subscript === this.subscript) {
          continue;
        }
        if (p.name === this.portName && p.subscript !== null && p.subscript > this.subscript) {
          updatedCPorts.push(p.withSubscript(p.subscript - 1));
        } else {
          updatedCPorts.push(p);
        }
      }
      return next.withCell(refreshedCell.withCPorts(updatedCPorts));
    }

    const target = cell.findEPort(this.portName, this.subscript);
    if (!target || target.subscript === null || target.arraySize !== null) return doc;

    for (const jid of target.joinIds) {
      next = disconnectJoin(next, jid);
    }
    const refreshedCell = next.getCell(this.cellId)!;

    const updatedEPorts: EPort[] = [];
    for (const p of refreshedCell.eports) {
      if (p.name === this.portName && p.subscript === this.subscript) {
        continue;
      }
      if (p.name === this.portName && p.subscript !== null && p.subscript > this.subscript) {
        updatedEPorts.push(p.withSubscript(p.subscript - 1));
      } else {
        updatedEPorts.push(p);
      }
    }
    return next.withCell(refreshedCell.withEPorts(updatedEPorts));
  }
}

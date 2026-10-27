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

    if (this.portKind === "CPort") {
      const target = cell.findCPort(this.portName, this.subscript);
      if (!target || target.subscript === null || target.arraySize !== null) return doc;

      const newOffset = clampOffset(cell, target.edgeSide, target.offset + (this.before ? -3 : 3));
      const newPort = CPort.create({
        name: target.name,
        signature: target.signature,
        edgeSide: target.edgeSide,
        offset: newOffset,
        subscript: insertIndex,
        arraySize: null,
      });

      const updatedCPorts: CPort[] = [];
      for (const p of cell.cports) {
        if (p.name === this.portName && p.subscript !== null) {
          if (p.subscript >= insertIndex) {
            updatedCPorts.push(p.withSubscript(p.subscript + 1));
          } else {
            updatedCPorts.push(p);
          }
        } else {
          updatedCPorts.push(p);
        }
      }
      const insertPos = updatedCPorts.findIndex(
        (p) => p.name === this.portName && p.subscript !== null && p.subscript > insertIndex,
      );
      if (insertPos >= 0) {
        updatedCPorts.splice(insertPos, 0, newPort);
      } else {
        updatedCPorts.push(newPort);
      }

      return doc.withCell(cell.withCPorts(updatedCPorts));
    }

    const target = cell.findEPort(this.portName, this.subscript);
    if (!target || target.subscript === null || target.arraySize !== null) return doc;

    const newOffset = clampOffset(cell, target.edgeSide, target.offset + (this.before ? -3 : 3));
    const newPort = EPort.create({
      name: target.name,
      signature: target.signature,
      edgeSide: target.edgeSide,
      offset: newOffset,
      subscript: insertIndex,
      arraySize: null,
    });

    const updatedEPorts: EPort[] = [];
    for (const p of cell.eports) {
      if (p.name === this.portName && p.subscript !== null) {
        if (p.subscript >= insertIndex) {
          updatedEPorts.push(p.withSubscript(p.subscript + 1));
        } else {
          updatedEPorts.push(p);
        }
      } else {
        updatedEPorts.push(p);
      }
    }
    const insertPos = updatedEPorts.findIndex(
      (p) => p.name === this.portName && p.subscript !== null && p.subscript > insertIndex,
    );
    if (insertPos >= 0) {
      updatedEPorts.splice(insertPos, 0, newPort);
    } else {
      updatedEPorts.push(newPort);
    }

    return doc.withCell(cell.withEPorts(updatedEPorts));
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

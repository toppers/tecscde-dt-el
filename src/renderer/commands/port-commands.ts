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
import { nextPortId, type CellId, type JoinId, type PortId } from "../model/ids";
import { CPort, EPort, type EdgeSide } from "../model/port";
import type { TecscdeDocument } from "../model/document";
import type { SelectedPort } from "../render/view";

function resolvePortRef(doc: TecscdeDocument, selected: SelectedPort): { readonly cell: Cell; readonly port: CPort | EPort } | undefined {
  const cell = doc.getCell(selected.cellId);
  if (!cell) return undefined;
  if (selected.kind === "cport") {
    const port =
      (selected.portId !== undefined ? cell.findCPortById(selected.portId) : undefined) ??
      cell.findCPort(selected.portName, selected.subscript);
    return port ? { cell, port } : undefined;
  }
  const port =
    (selected.portId !== undefined ? cell.findEPortById(selected.portId) : undefined) ??
    cell.findEPort(selected.portName, selected.subscript);
  return port ? { cell, port } : undefined;
}

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
        arrayKind: "variable",
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
        arrayKind: "variable",
      });
      next = doc.withCell(cell.withCPorts(cell.cports.map(adjust)).withEPorts(insertAt(cell.eports.map(adjust), created)));
    }

    // 添字が繰り上がったポートに接続されている結合の添字情報（cportSubscript/eportSubscript）を同期更新する
    for (const join of next.joinValues()) {
      let cSub = join.cportSubscript;
      let eSub = join.eportSubscript;
      if (
        this.portKind === "CPort" &&
        join.cellId === this.cellId &&
        join.cportName === this.portName &&
        cSub !== null &&
        cSub >= insertIndex
      ) {
        cSub = cSub + 1;
      }
      if (
        this.portKind === "EPort" &&
        join.eportCellId === this.cellId &&
        join.eportName === this.portName &&
        eSub !== null &&
        eSub >= insertIndex
      ) {
        eSub = eSub + 1;
      }
      if (cSub !== join.cportSubscript || eSub !== join.eportSubscript) {
        next = next.withJoin(join.withSubscripts(cSub, eSub));
      }
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
      next = next.withCell(refreshedCell.withCPorts(updatedCPorts));
      for (const join of next.joinValues()) {
        if (
          join.cellId === this.cellId &&
          join.cportName === this.portName &&
          join.cportSubscript !== null &&
          join.cportSubscript > this.subscript
        ) {
          next = next.withJoin(join.withSubscripts(join.cportSubscript - 1, join.eportSubscript));
        }
      }
      return next;
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
    next = next.withCell(refreshedCell.withEPorts(updatedEPorts));
    for (const join of next.joinValues()) {
      if (
        join.eportCellId === this.cellId &&
        join.eportName === this.portName &&
        join.eportSubscript !== null &&
        join.eportSubscript > this.subscript
      ) {
        next = next.withJoin(join.withSubscripts(join.cportSubscript, join.eportSubscript - 1));
      }
    }
    return next;
  }
}

// --- V0.3.2 段2: 内部仕様 04E / 04F 準拠の計画・コマンド（6-1〜6-5） ---

export type ArrayPortInsertionRejectReason =
  | "selection"
  | "read-only"
  | "not-found"
  | "fixed-array"
  | "unresolved"
  | "not-array"
  | "readonly-reference"
  | "no-space";

export interface ArrayPortInsertionPlan {
  readonly cellId: CellId;
  readonly portKind: PortKind;
  readonly portName: string;
  readonly anchorPortId: PortId;
  readonly expectedElementIds: readonly PortId[];
  readonly insertIndex: number;
  readonly newPortId: PortId;
  readonly edgeSide: EdgeSide;
  readonly newOffset: number;
  readonly movedOffsets: readonly { readonly portId: PortId; readonly offset: number }[];
}

export type ArrayPortInsertionResult =
  | { readonly ok: true; readonly plan: ArrayPortInsertionPlan }
  | { readonly ok: false; readonly reason: ArrayPortInsertionRejectReason; readonly message: string };

/**
 * 内部仕様 04E 4E.4（6-5）: 同じ配列グループ内（同じセル・方向・宣言名・同じ辺）に限定して
 * 挿入位置と押し出し先を計画する。辺上に MIN_PORT_GAP_MM 間隔で収まらない場合は undefined を返す。
 */
function planArrayGroupInsertPosition(
  cell: Cell,
  groupOnEdge: readonly (CPort | EPort)[],
  edge: EdgeSide,
  anchor: number,
): { newOffset: number; movedOffsets: readonly { readonly portId: PortId; readonly offset: number }[] } | undefined {
  const maxLen = edgeLength(cell, edge);
  const totalCount = groupOnEdge.length + 1;
  if ((totalCount - 1) * MIN_PORT_GAP_MM > maxLen) return undefined;

  const nextOffset = Math.min(...groupOnEdge.map((p) => p.offset).filter((offset) => offset > anchor));
  const newProposed = anchor + INSERT_PORT_GAP_MM;
  const push = Number.isFinite(nextOffset) ? Math.max(0, INSERT_PORT_GAP_MM * 2 - (nextOffset - anchor)) : 0;

  const items = [
    { port: null as CPort | EPort | null, offset: clampOffset(cell, edge, newProposed), origin: anchor + 0.5, subscript: -2, moves: true },
    ...groupOnEdge.map((port) => {
      const moves = port.offset > anchor;
      return {
        port: port as CPort | EPort | null,
        offset: moves ? clampOffset(cell, edge, port.offset + push) : port.offset,
        origin: port.offset,
        subscript: port.subscript ?? -1,
        moves,
      };
    }),
  ];
  // 昇順に並べてから、後ろから端へ押し戻し、前から 0 以上へ押し出して間隔を検証する。
  items.sort((x, y) => x.offset - y.offset || x.origin - y.origin || x.subscript - y.subscript);

  let upper = maxLen;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    const bounded = Math.min(item.offset, upper);
    item.offset = bounded;
    upper = bounded - MIN_PORT_GAP_MM;
  }
  let lower = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const bounded = Math.max(item.offset, lower);
    if (bounded > maxLen) return undefined;
    item.offset = bounded;
    lower = bounded + MIN_PORT_GAP_MM;
  }
  for (let i = 1; i < items.length; i += 1) {
    if (items[i]!.offset - items[i - 1]!.offset < MIN_PORT_GAP_MM - 1e-6) return undefined;
  }

  const created = items.find((item) => item.port === null)!;
  const movedOffsets: { readonly portId: PortId; readonly offset: number }[] = [];
  for (const item of items) {
    if (item.port && item.offset !== item.port.offset) {
      movedOffsets.push({ portId: item.port.id, offset: item.offset });
    }
  }
  return { newOffset: created.offset, movedOffsets };
}

function arrayGroupPorts(cell: Cell, portKind: PortKind, portName: string): readonly (CPort | EPort)[] {
  const list = portKind === "CPort" ? cell.cports : cell.eports;
  return list.filter((p) => p.name === portName);
}

function hasReadonlyEntryReference(
  doc: TecscdeDocument,
  targetCellId: CellId,
  eportName: string,
  affectedSubscriptFrom: number,
): boolean {
  for (const join of doc.joinValues()) {
    if (
      join.eportCellId === targetCellId &&
      join.eportName === eportName &&
      join.eportSubscript !== null &&
      join.eportSubscript >= affectedSubscriptFrom
    ) {
      const source = doc.getCell(join.cellId);
      if (!source || !source.editable) return true;
    }
  }
  return false;
}

/** 内部仕様 04E 4E.3: Insert 単独による可変長配列ポート要素の直後挿入を計画する。 */
export function prepareArrayPortInsertion(
  doc: TecscdeDocument,
  selectedPorts: readonly SelectedPort[],
): ArrayPortInsertionResult {
  if (selectedPorts.length !== 1) {
    return { ok: false, reason: "selection", message: "可変長配列ポートの要素を1つだけ選択してください" };
  }
  const selected = selectedPorts[0]!;
  const cell = doc.getCell(selected.cellId);
  if (!cell) {
    return { ok: false, reason: "not-found", message: "選択したポートが見つかりません" };
  }
  if (!cell.editable) {
    return { ok: false, reason: "read-only", message: "読み込み専用セルのポートは編集できません" };
  }
  const resolved = resolvePortRef(doc, selected);
  if (!resolved) {
    return { ok: false, reason: "not-found", message: "選択したポートが見つかりません" };
  }
  const port = resolved.port;
  if (port.arrayKind === "fixed") {
    return { ok: false, reason: "fixed-array", message: "固定長配列には要素を挿入できません。" };
  }
  if (port.arrayKind === "unresolved") {
    return { ok: false, reason: "unresolved", message: "配列長が未解決のポートには要素を挿入できません" };
  }
  if (port.arrayKind !== "variable" || port.subscript === null) {
    return { ok: false, reason: "not-array", message: "配列ポートではありません" };
  }

  const portKind: PortKind = selected.kind === "cport" ? "CPort" : "EPort";
  const insertIndex = port.subscript + 1;
  if (portKind === "EPort" && hasReadonlyEntryReference(doc, cell.id, port.name, insertIndex)) {
    return {
      ok: false,
      reason: "readonly-reference",
      message: "読み取り専用セルからの結合参照を更新できないため、要素を挿入できません",
    };
  }

  const group = arrayGroupPorts(cell, portKind, port.name);
  const groupOnEdge = group.filter((p) => p.edgeSide === port.edgeSide);
  const layout = planArrayGroupInsertPosition(cell, groupOnEdge, port.edgeSide, port.offset);
  if (!layout) {
    return { ok: false, reason: "no-space", message: "辺上に要素を配置できる空き位置がありません" };
  }

  return {
    ok: true,
    plan: {
      cellId: cell.id,
      portKind,
      portName: port.name,
      anchorPortId: port.id,
      expectedElementIds: group.map((p) => p.id),
      insertIndex,
      newPortId: nextPortId(portKind === "CPort" ? "cport" : "eport"),
      edgeSide: port.edgeSide,
      newOffset: layout.newOffset,
      movedOffsets: layout.movedOffsets,
    },
  };
}

/** 内部仕様 04E 4E.3: 確定済み挿入計画を同期・副作用なしで適用するコマンド。 */
export class InsertArrayPortElementCommand extends Command {
  readonly kind = "InsertArrayPortElement";
  override readonly summary: string;

  constructor(private readonly plan: ArrayPortInsertionPlan) {
    super();
    this.summary = `insert ${plan.portName}[${plan.insertIndex}]`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.plan.cellId);
    if (!cell || !cell.editable) return doc;

    const group = arrayGroupPorts(cell, this.plan.portKind, this.plan.portName);
    // 二重適用防止・前提一致検査
    if (group.some((p) => p.id === this.plan.newPortId)) return doc;
    if (
      group.length !== this.plan.expectedElementIds.length ||
      group.some((p, i) => p.id !== this.plan.expectedElementIds[i])
    ) {
      return doc;
    }
    const anchor = group.find((p) => p.id === this.plan.anchorPortId);
    if (!anchor || anchor.arrayKind !== "variable" || anchor.subscript === null) return doc;
    if (
      this.plan.portKind === "EPort" &&
      hasReadonlyEntryReference(doc, cell.id, this.plan.portName, this.plan.insertIndex)
    ) {
      return doc;
    }

    const offsetMap = new Map<PortId, number>(this.plan.movedOffsets.map((m) => [m.portId, m.offset]));
    const movedJoinIds: JoinId[] = [];
    const adjust = <P extends CPort | EPort>(port: P): P => {
      if (port.name !== this.plan.portName) return port;
      let next: P = port;
      if (port.subscript !== null && port.subscript >= this.plan.insertIndex) {
        next = next.withSubscript(port.subscript + 1) as P;
      }
      const nextOffset = offsetMap.get(port.id);
      if (nextOffset !== undefined && nextOffset !== port.offset) {
        next = next.withEdge(port.edgeSide, nextOffset) as P;
        movedJoinIds.push(...(port instanceof CPort ? joinIdsOfCPort(port) : port.joinIds));
      }
      return next;
    };
    const insertAt = <P extends CPort | EPort>(list: P[], created: P): P[] => {
      const pos = list.findIndex(
        (p) => p.name === this.plan.portName && p.subscript !== null && p.subscript > this.plan.insertIndex,
      );
      if (pos >= 0) list.splice(pos, 0, created);
      else list.push(created);
      return list;
    };

    let next: TecscdeDocument;
    if (this.plan.portKind === "CPort") {
      const created = CPort.create({
        id: this.plan.newPortId,
        name: anchor.name,
        signature: anchor.signature,
        edgeSide: this.plan.edgeSide,
        offset: this.plan.newOffset,
        subscript: this.plan.insertIndex,
        arraySize: null,
        arrayKind: "variable",
      });
      next = doc.withCell(cell.withCPorts(insertAt(cell.cports.map(adjust), created)));
    } else {
      const created = EPort.create({
        id: this.plan.newPortId,
        name: anchor.name,
        signature: anchor.signature,
        edgeSide: this.plan.edgeSide,
        offset: this.plan.newOffset,
        subscript: this.plan.insertIndex,
        arraySize: null,
        arrayKind: "variable",
      });
      next = doc.withCell(cell.withEPorts(insertAt(cell.eports.map(adjust), created)));
    }

    for (const join of next.joinValues()) {
      let cSub = join.cportSubscript;
      let eSub = join.eportSubscript;
      if (
        this.plan.portKind === "CPort" &&
        join.cellId === this.plan.cellId &&
        join.cportName === this.plan.portName &&
        cSub !== null &&
        cSub >= this.plan.insertIndex
      ) {
        cSub += 1;
      }
      if (
        this.plan.portKind === "EPort" &&
        join.eportCellId === this.plan.cellId &&
        join.eportName === this.plan.portName &&
        eSub !== null &&
        eSub >= this.plan.insertIndex
      ) {
        eSub += 1;
      }
      if (cSub !== join.cportSubscript || eSub !== join.eportSubscript) {
        next = next.withJoin(join.withSubscripts(cSub, eSub));
      }
    }

    return reroutePortJoins(next, movedJoinIds);
  }
}

export interface ArrayPortDeletionGroupPlan {
  readonly cellId: CellId;
  readonly portKind: PortKind;
  readonly portName: string;
  readonly expectedElementIds: readonly PortId[];
  readonly deletePortIds: readonly PortId[];
}

export interface ArrayPortElementDeletionPlan {
  readonly groups: readonly ArrayPortDeletionGroupPlan[];
  readonly allDeletePortIds: readonly PortId[];
}

export type ArrayPortElementDeletionResult =
  | { readonly ok: true; readonly plan: ArrayPortElementDeletionPlan }
  | { readonly ok: false; readonly message: string };

/**
 * 内部仕様 04F 4F.2・4F.3（6-2）: 未結合の配列ポート要素削除計画を作成する。
 * 削除可能要素と拒否対象が混在した場合は計画全体を拒否し、部分削除しない。
 */
export function prepareArrayPortElementDeletion(
  doc: TecscdeDocument,
  selectedPorts: readonly SelectedPort[],
): ArrayPortElementDeletionResult {
  if (selectedPorts.length === 0) {
    return { ok: false, message: "削除対象のポートが選択されていません" };
  }

  const seenPortIds = new Set<PortId>();
  const reasons: string[] = [];
  const grouped = new Map<string, { cellId: CellId; portKind: PortKind; portName: string; deleteIds: PortId[]; minSubscript: number }>();

  for (const selected of selectedPorts) {
    const cell = doc.getCell(selected.cellId);
    if (!cell) {
      reasons.push("セルが見つかりません");
      continue;
    }
    if (!cell.editable) {
      reasons.push("読み取り専用セルのポートは削除できません");
      continue;
    }
    const resolved = resolvePortRef(doc, selected);
    if (!resolved) {
      reasons.push("ポートが見つかりません");
      continue;
    }
    const port = resolved.port;
    if (seenPortIds.has(port.id)) continue;
    seenPortIds.add(port.id);

    const hasJoin = port instanceof CPort ? port.joinId !== null : port.joinIds.length > 0;
    if (hasJoin) {
      reasons.push("結合済みの要素は直接削除できません");
      continue;
    }
    if (port.arrayKind === "fixed") {
      reasons.push("固定長配列の要素は削除できません。");
      continue;
    }
    if (port.arrayKind === "unresolved") {
      reasons.push("配列長が未解決のポートは削除できません");
      continue;
    }
    if (port.arrayKind !== "variable" || port.subscript === null) {
      reasons.push("非配列ポートは個別に削除できません");
      continue;
    }
    if (port.subscript === 0) {
      reasons.push("先頭要素は削除できません");
      continue;
    }

    const portKind: PortKind = selected.kind === "cport" ? "CPort" : "EPort";
    const key = `${cell.id}\0${portKind}\0${port.name}`;
    const entry = grouped.get(key);
    if (entry) {
      entry.deleteIds.push(port.id);
      entry.minSubscript = Math.min(entry.minSubscript, port.subscript);
    } else {
      grouped.set(key, {
        cellId: cell.id,
        portKind,
        portName: port.name,
        deleteIds: [port.id],
        minSubscript: port.subscript,
      });
    }
  }

  // 受け口の添字変更で読み取り専用参照元の書き換えが必要になる場合は全体拒否（4F.5）
  for (const g of grouped.values()) {
    if (g.portKind === "EPort" && hasReadonlyEntryReference(doc, g.cellId, g.portName, g.minSubscript + 1)) {
      reasons.push(`${g.portName}: 読み取り専用セルからの結合参照を更新できないため削除できません`);
    }
  }

  if (reasons.length > 0 || grouped.size === 0) {
    return { ok: false, message: reasons.join(" / ") || "削除できる配列要素がありません" };
  }

  const groups: ArrayPortDeletionGroupPlan[] = [];
  const allDeletePortIds: PortId[] = [];
  for (const g of grouped.values()) {
    const cell = doc.getCell(g.cellId)!;
    const expectedElementIds = arrayGroupPorts(cell, g.portKind, g.portName).map((p) => p.id);
    groups.push({
      cellId: g.cellId,
      portKind: g.portKind,
      portName: g.portName,
      expectedElementIds,
      deletePortIds: g.deleteIds,
    });
    allDeletePortIds.push(...g.deleteIds);
  }

  return { ok: true, plan: { groups, allDeletePortIds } };
}

/** 内部仕様 04F 4F.3: 未結合の配列ポート要素を一括削除・再添字するコマンド。 */
export class DeleteArrayPortElementsCommand extends Command {
  readonly kind = "DeleteArrayPortElements";
  override readonly summary: string;

  constructor(private readonly plan: ArrayPortElementDeletionPlan) {
    super();
    this.summary = `delete ${plan.allDeletePortIds.length} array port element(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    // 全グループの前提を一括検査（1つでも不一致があれば元の doc を返す）
    for (const g of this.plan.groups) {
      const cell = doc.getCell(g.cellId);
      if (!cell || !cell.editable) return doc;
      const group = arrayGroupPorts(cell, g.portKind, g.portName);
      if (
        group.length !== g.expectedElementIds.length ||
        group.some((p, i) => p.id !== g.expectedElementIds[i])
      ) {
        return doc;
      }
      const deleteSet = new Set(g.deletePortIds);
      let minSub = Number.POSITIVE_INFINITY;
      for (const p of group) {
        if (!deleteSet.has(p.id)) continue;
        if (p.arrayKind !== "variable" || p.subscript === null || p.subscript === 0) return doc;
        const hasJoin = p instanceof CPort ? p.joinId !== null : p.joinIds.length > 0;
        if (hasJoin) return doc;
        minSub = Math.min(minSub, p.subscript);
      }
      if (g.portKind === "EPort" && hasReadonlyEntryReference(doc, g.cellId, g.portName, minSub + 1)) {
        return doc;
      }
    }

    let next = doc;
    for (const g of this.plan.groups) {
      const cell = next.getCell(g.cellId)!;
      const deleteSet = new Set(g.deletePortIds);
      const deletedSubscripts = arrayGroupPorts(cell, g.portKind, g.portName)
        .filter((p) => deleteSet.has(p.id) && p.subscript !== null)
        .map((p) => p.subscript!);
      const shiftOf = (sub: number): number => deletedSubscripts.filter((d) => d < sub).length;

      if (g.portKind === "CPort") {
        const updated: CPort[] = [];
        for (const p of cell.cports) {
          if (p.name === g.portName && deleteSet.has(p.id)) continue;
          if (p.name === g.portName && p.subscript !== null) {
            const d = shiftOf(p.subscript);
            updated.push(d > 0 ? p.withSubscript(p.subscript - d) : p);
          } else {
            updated.push(p);
          }
        }
        next = next.withCell(cell.withCPorts(updated));
        for (const join of next.joinValues()) {
          if (join.cellId === g.cellId && join.cportName === g.portName && join.cportSubscript !== null) {
            const d = shiftOf(join.cportSubscript);
            if (d > 0) next = next.withJoin(join.withSubscripts(join.cportSubscript - d, join.eportSubscript));
          }
        }
      } else {
        const updated: EPort[] = [];
        for (const p of cell.eports) {
          if (p.name === g.portName && deleteSet.has(p.id)) continue;
          if (p.name === g.portName && p.subscript !== null) {
            const d = shiftOf(p.subscript);
            updated.push(d > 0 ? p.withSubscript(p.subscript - d) : p);
          } else {
            updated.push(p);
          }
        }
        next = next.withCell(cell.withEPorts(updated));
        for (const join of next.joinValues()) {
          if (join.eportCellId === g.cellId && join.eportName === g.portName && join.eportSubscript !== null) {
            const d = shiftOf(join.eportSubscript);
            if (d > 0) next = next.withJoin(join.withSubscripts(join.cportSubscript, join.eportSubscript - d));
          }
        }
      }
    }

    return next;
  }
}

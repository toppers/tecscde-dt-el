// [[TECSCDE-DT-EL内部仕様]] 第5章5.3節 — ドラッグ状態機械 `GestureController`。
//
// 外部ライブラリ（XState等）は使わず、外部仕様3.7の4状態を判別可能なUnion型で表現する。
// 遷移の終端で第4章のコマンドを発行する。E（描画）・G（UIシェル）はこの状態機械を
// 経由してのみモデルを変更でき、C・Dへの直接書き込み経路を持たない
// （第2章2.2節の保証をコードレベルでも表現する）。
//
// 仕様スケッチは `constructor(svg, renderer, host)` でコンストラクタ内でDOMリスナを張るが、
// 本実装は状態機械そのものをヘッドレスで検証できるよう、ポインタ操作を公開メソッド
// （`pointerDown`/`pointerMove`/`pointerUp`/`keyDown`）に分け、DOMイベントの結線を
// `attach(svg)` に分離する（5.3節が状態機械を設計の核と位置づけていること、
// 本リポジトリが契約テスト中心で進めていることに合わせた逸脱）。
//
// `private state` はこのクラスに閉じたUI一時状態であり、モデルではない。`CLAUDE.md` の
// イミュータブル方針は `TecscdeDocument`・`Cell`・`Command` 等のドメインデータに適用される
// （5.3節の note）。

import { HitTester, type HitResult } from "./hit-tester";
import { pxPerMm, SelectionState, type CanvasView, type SelectedPort } from "./view";
import type { JoinPreviewLine } from "./svg-renderer";
import { ALIGN_MM, alignRound } from "../model/align";
import { moveBarBars, portPosition } from "../model/geometry";
import type { Point } from "../model/geometry";
import type { Cell } from "../model/cell";
import type { Bar, Join } from "../model/join";
import type { EdgeSide } from "../model/port";
import type { CellId, JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";
import { Command } from "../commands/command";
import {
  AddCellCommand,
  ChangePortEdgeCommand,
  CreateJoinCommand,
  DeleteCommand,
  InsertPortElementCommand,
  MoveCellsCommand,
  MoveJoinBarCommand,
  MovePortsCommand,
} from "../commands";

/** 修飾キーの状態。DOM `MouseEvent`/`KeyboardEvent` から抜き出した最小集合。 */
export interface Mods {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  /** Alt+ドラッグでポート移動、Alt+Shift+ドラッグで所属辺の変更（外部仕様4.3.2。操作の割り当ては2026-10-28決定）。 */
  readonly alt?: boolean;
}

const NO_MODS: Mods = { ctrl: false, shift: false, meta: false };

/** セル単位で名前空間化されたポートの参照（配列ポートは subscript で識別）。 */
export interface PortRef {
  readonly cellId: CellId;
  readonly portName: string;
  readonly subscript: number | null;
}

function portRefEquals(a: PortRef | undefined, b: PortRef | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.cellId === b.cellId && a.portName === b.portName && a.subscript === b.subscript;
}

/**
 * ドラッグの有限状態機械。外部仕様3.7の4状態（通常／呼び口の上→`joining`／
 * 結合操作中／結合先として有効→`joining` の `to`）に、セル移動・矩形選択・
 * 結合バー移動の遷移を加えたもの（挙動の正典: [[TECSCDE内部仕様]] 6.4節）。
 */
type DragState =
  | { readonly kind: "idle" }
  | { readonly kind: "movingCells"; readonly start: Point; readonly ids: ReadonlySet<CellId> }
  | { readonly kind: "boxSelect"; readonly start: Point }
  | { readonly kind: "joining"; readonly from: PortRef; readonly to?: PortRef }
  | {
      readonly kind: "movingPorts";
      readonly start: Point;
      /** true なら所属辺の変更（`anchor` 1個のみ）、false なら辺上の移動（選択中の全ポート）。 */
      readonly edgeChange: boolean;
      readonly anchor: SelectedPort;
    }
  | {
      readonly kind: "movingJoinBar";
      readonly joinId: JoinId;
      readonly barIndex: number;
      readonly axis: "x" | "y";
      readonly startFixed: number;
      readonly startPoint: Point;
    };

/** `GestureController` が発行先とする UI シェル／アプリ層の窓口。 */
export interface GestureHost {
  getDocument(): TecscdeDocument;
  getView(): CanvasView;
  getSelection(): SelectionState;
  setSelection(sel: SelectionState): void;
  dispatch(command: Command): void;
  /** 外部仕様3.3.2: 「選択」「セル新規作成」の2モード。 */
  getMode(): "select" | "newCell";
  getActiveCelltypeName(): string | undefined;
  /** ステータス表示用（第6章6.2節）。 */
  onPointerModelPosition?(point: Point | undefined): void;
  /** 利用者への拒否理由や案内メッセージ通知（外部仕様6.1.2・6.3.2）。 */
  postMessage?(message: string): void;
  requestRender(): void;
}

/**
 * ドラッグ中の暫定描画の受け口（`SvgRenderer` が構造的に満たす）。
 * テストでは spy / no-op を渡す。
 */
export interface GesturePreviewSink {
  setDragPreview(cellIds: ReadonlySet<CellId>, dxPx: number, dyPx: number): void;
  clearDragPreview(): void;
  setJoinBarPreview(join: Join, bars: readonly Bar[], source: Cell, target: Cell, view: CanvasView): void;
  clearJoinBarPreview(): void;
  renderSelectionBox(view: CanvasView, box: { a: Point; b: Point } | undefined): void;
  screenToModel(px: Point, view: CanvasView): Point;
}

const ARROW_DELTA: Readonly<Record<string, readonly [number, number] | undefined>> = {
  ArrowUp: [0, -ALIGN_MM],
  ArrowDown: [0, ALIGN_MM],
  ArrowLeft: [-ALIGN_MM, 0],
  ArrowRight: [ALIGN_MM, 0],
};

export class GestureController {
  private state: DragState = { kind: "idle" };
  private lastModelPoint: Point | undefined;

  constructor(
    private readonly sink: GesturePreviewSink,
    private readonly host: GestureHost,
  ) {}

  /** 現在の状態種別（テスト・ステータス表示用）。 */
  get stateKind(): DragState["kind"] {
    return this.state.kind;
  }

  private hitTester(): HitTester {
    return new HitTester(this.host.getDocument(), this.host.getView());
  }

  private transition(next: DragState): void {
    this.state = next;
  }

  // --- ポインタ操作（DOM非依存。`attach` がDOMイベントからこれらを呼ぶ） ---

  pointerDown(point: Point, mods: Mods = NO_MODS): void {
    const doc = this.host.getDocument();
    const hit = this.hitTester().hitTest(point);

    if (this.host.getMode() === "newCell") {
      const celltypeName = this.host.getActiveCelltypeName();
      if (hit.kind === "none" && !celltypeName) {
        this.host.postMessage?.("パレットでセルタイプを選択してください");
        return;
      }
      if (hit.kind === "none" && celltypeName) {
        const selectedIds = [...this.host.getSelection().cellIds];
        const selectedCell = selectedIds.length === 1 ? doc.getCell(selectedIds[0]!) : undefined;
        const targetSource = selectedCell?.editable && selectedCell.locale && doc.sourceTemplates.has(selectedCell.locale)
          ? selectedCell.locale : undefined;
        this.host.dispatch(new AddCellCommand(celltypeName, point.x, point.y, targetSource));
      }
      return;
    }

    if (hit.kind === "cport" || hit.kind === "eport") {
      if (mods.alt) {
        const movable = doc.getCell(hit.cellId);
        if (!movable?.editable) {
          this.host.postMessage?.("読み込み専用セルのポートは移動できません");
          return;
        }
        const current = this.host.getSelection();
        // 辺の変更は1個ずつ。移動は、すでに選択中のポートならその選択ごと動かす。
        const edgeChange = mods.shift;
        this.host.setSelection(!edgeChange && current.hasPort(hit) ? current : SelectionState.ofPort(hit));
        this.transition({ kind: "movingPorts", start: point, edgeChange, anchor: hit });
        return;
      }

      const cell = doc.getCell(hit.cellId);
      const cport = hit.kind === "cport"
        ? cell?.cports.find((p) => p.name === hit.portName && p.subscript === hit.subscript) : undefined;
      // 結合済み呼び口の通常操作は結合を開始しない。修飾クリックで参照選択できる。
      if (cport?.joinId != null && !mods.shift && !mods.ctrl && !mods.meta) {
        this.host.postMessage?.("この呼び口は結合済みです。Shift+クリックで選択、結合を削除するには結合を選択して Delete");
        return;
      }
      const current = this.host.getSelection();
      const next = mods.ctrl || mods.meta ? current.withPortToggled(hit)
        : mods.shift ? current.withPortAdded(hit)
        : current.hasPort(hit) ? current : SelectionState.ofPort(hit);
      this.host.setSelection(next);
      if (cport && cport.joinId === null && !mods.shift && !mods.ctrl && !mods.meta) {
        this.transition({
          kind: "joining",
          from: { cellId: hit.cellId, portName: hit.portName, subscript: hit.subscript },
        });
      } else {
        this.transition({ kind: "idle" });
      }
      return;
    }

    if (hit.kind === "cell") {
      const current = this.host.getSelection();
      let next: SelectionState;
      if (mods.ctrl || mods.meta) next = current.withCellToggled(hit.cellId);
      else if (mods.shift) next = current.withCellAdded(hit.cellId);
      else if (current.hasCell(hit.cellId)) next = current; // 既選択オブジェクトのクリックは維持（6.2.1）
      else next = SelectionState.ofCells([hit.cellId]);
      this.host.setSelection(next);
      this.transition({ kind: "movingCells", start: point, ids: next.cellIds });
      return;
    }

    if (hit.kind === "joinBar") {
      const current = this.host.getSelection();
      let next: SelectionState;
      if (mods.ctrl || mods.meta) next = current.withJoinToggled(hit.joinId);
      else if (mods.shift) next = current.withJoinAdded(hit.joinId);
      else if (current.hasJoin(hit.joinId)) next = current;
      else next = SelectionState.ofJoin(hit.joinId);
      this.host.setSelection(next);

      if (!next.hasJoin(hit.joinId)) {
        this.transition({ kind: "idle" });
        return;
      }

      const join = doc.getJoin(hit.joinId);
      const bar = join?.bars[hit.barIndex];
      // 先頭・末尾のバー（ポート直結区間）は移動対象外（geometry.moveBarBars 参照）。
      if (join && bar && hit.barIndex > 0 && hit.barIndex < join.bars.length - 1) {
        this.transition({
          kind: "movingJoinBar",
          joinId: hit.joinId,
          barIndex: hit.barIndex,
          axis: bar.direction === "H" ? "y" : "x",
          startFixed: bar.fixed,
          startPoint: point,
        });
      }
      return;
    }

    // 空白クリック → 矩形選択の開始。
    if (!mods.shift && !mods.ctrl && !mods.meta) {
      this.host.setSelection(SelectionState.empty());
    }
    this.transition({ kind: "boxSelect", start: point });
  }

  pointerMove(point: Point): void {
    this.lastModelPoint = point;
    this.host.onPointerModelPosition?.(point);
    const view = this.host.getView();
    const s = this.state;

    if (s.kind === "movingCells") {
      const dx = alignRound(point.x - s.start.x);
      const dy = alignRound(point.y - s.start.y);
      const k = pxPerMm(view);
      this.sink.setDragPreview(s.ids, dx * k, dy * k);
      return;
    }

    if (s.kind === "boxSelect") {
      this.sink.renderSelectionBox(view, { a: s.start, b: point });
      return;
    }

    if (s.kind === "joining") {
      const hit = this.hitTester().hitTest(point);
      const to =
        hit.kind === "eport" && this.signatureMatches(s.from, hit)
          ? { cellId: hit.cellId, portName: hit.portName, subscript: hit.subscript }
          : undefined;
      if (!portRefEquals(s.to, to)) this.transition({ kind: "joining", from: s.from, to });
      this.host.requestRender(); // プレビュー線をカーソルへ追従させる
      return;
    }

    if (s.kind === "movingJoinBar") {
      const doc = this.host.getDocument();
      const join = doc.getJoin(s.joinId);
      const source = join ? doc.getCell(join.cellId) : undefined;
      const target = join ? doc.getCell(join.eportCellId) : undefined;
      if (!join || !source || !target) return;
      const delta = s.axis === "y" ? point.y - s.startPoint.y : point.x - s.startPoint.x;
      const bars = moveBarBars(join.bars, s.barIndex, s.startFixed + delta);
      if (bars) this.sink.setJoinBarPreview(join, bars, source, target, view);
      return;
    }
  }

  pointerUp(point: Point): void {
    const view = this.host.getView();
    const s = this.state;

    if (s.kind === "movingCells") {
      const dx = alignRound(point.x - s.start.x);
      const dy = alignRound(point.y - s.start.y);
      this.sink.clearDragPreview();
      if (dx !== 0 || dy !== 0) this.host.dispatch(new MoveCellsCommand([...s.ids], dx, dy));
      this.transition({ kind: "idle" });
      this.host.requestRender();
      return;
    }

    if (s.kind === "boxSelect") {
      const ids = this.hitTester().hitTestRect(s.start, point);
      this.sink.renderSelectionBox(view, undefined);
      if (ids.length > 0) this.host.setSelection(SelectionState.ofCells(ids));
      this.transition({ kind: "idle" });
      return;
    }

    if (s.kind === "joining") {
      const hit = this.hitTester().hitTest(point);
      if (hit.kind === "eport") {
        // シグニチャ不一致・結合済み呼び口は CreateJoinCommand が静かにキャンセルする（6.4.2）。
        this.host.dispatch(
          new CreateJoinCommand(s.from.cellId, s.from.portName, s.from.subscript, hit.cellId, hit.portName),
        );
      }
      this.transition({ kind: "idle" });
      this.host.requestRender();
      return;
    }

    if (s.kind === "movingPorts") {
      this.transition({ kind: "idle" });
      const command = s.edgeChange ? this.edgeChangeCommand(s.anchor, point) : this.movePortsCommand(s.start, point);
      if (command) this.host.dispatch(command);
      this.host.requestRender();
      return;
    }

    if (s.kind === "movingJoinBar") {
      const delta = s.axis === "y" ? point.y - s.startPoint.y : point.x - s.startPoint.x;
      this.sink.clearJoinBarPreview();
      if (delta !== 0) {
        this.host.dispatch(new MoveJoinBarCommand(s.joinId, s.barIndex, s.startFixed + delta));
      }
      this.transition({ kind: "idle" });
      this.host.requestRender();
      return;
    }
  }

  /**
   * キー入力を処理する。処理した場合は true（呼び出し側が `preventDefault` する）。
   * 削除・矢印キー移動はキャンバス上の選択に対して働く（[[TECSCDE内部仕様]] 6.3節）。
   * 外部仕様6.1.1・6.1.2: Insert キー（Shift+Insert）による配列ポート要素の挿入。
   * 外部仕様6.3.1・6.3.2: Delete キーによる配列ポート要素の削除。
   */
  keyDown(key: string, mods: Mods = NO_MODS): boolean {
    if (key === "Insert") {
      const sel = this.host.getSelection();
      if (sel.ports.length > 0) {
        const selected = sel.ports[0]!;
        const doc = this.host.getDocument();
        const cell = doc.getCell(selected.cellId);
        if (!cell || !cell.editable) {
          this.host.postMessage?.("読み込み専用セルのポートは編集できません");
          return true;
        }
        const port =
          selected.kind === "cport"
            ? cell.findCPort(selected.portName, selected.subscript)
            : cell.findEPort(selected.portName, selected.subscript);
        if (!port) return false;

        if (selected.subscript === null && port.arraySize === null) {
          this.host.postMessage?.("配列ポートではありません");
          return true;
        }
        if (port.arraySize !== null) {
          this.host.postMessage?.("固定長配列には要素を追加できません");
          return true;
        }

        this.host.dispatch(
          new InsertPortElementCommand(
            selected.cellId,
            selected.kind === "cport" ? "CPort" : "EPort",
            selected.portName,
            selected.subscript ?? 0,
            mods.shift,
          ),
        );
        return true;
      }
      return false;
    }

    if (key === "Delete" || key === "Backspace") {
      const sel = this.host.getSelection();
      const doc = this.host.getDocument();

      const joinIdsToDelete = new Set<JoinId>(sel.joinIds);
      for (const p of sel.ports) {
        const cell = doc.getCell(p.cellId);
        if (!cell || !cell.editable) continue;
        if (p.kind === "cport") {
          const port = cell.findCPort(p.portName, p.subscript);
          if (port?.joinId) joinIdsToDelete.add(port.joinId);
        } else {
          const port = cell.findEPort(p.portName, p.subscript);
          if (port) {
            for (const jid of port.joinIds) joinIdsToDelete.add(jid);
          }
        }
      }

      const deletablePorts = sel.ports.filter((p) => {
        const cell = doc.getCell(p.cellId);
        if (!cell || !cell.editable) return false;
        if (p.subscript === null || p.subscript === 0) return false;
        const port =
          p.kind === "cport"
            ? cell.findCPort(p.portName, p.subscript)
            : cell.findEPort(p.portName, p.subscript);
        if (!port || port.arraySize !== null) return false;
        return true;
      });

      for (const p of sel.ports) {
        const cell = doc.getCell(p.cellId);
        if (!cell || !cell.editable) continue;
        const port =
          p.kind === "cport"
            ? cell.findCPort(p.portName, p.subscript)
            : cell.findEPort(p.portName, p.subscript);
        if (!port) continue;

        const hasConnectedJoin =
          "joinId" in port ? port.joinId !== null : port.joinIds.length > 0;
        if (hasConnectedJoin) continue;

        if (port.arraySize !== null && p.subscript !== null) {
          this.host.postMessage?.("固定長配列の要素は削除できません");
        } else if (p.subscript === 0) {
          this.host.postMessage?.("先頭要素は削除できません");
        }
      }

      if (sel.cellIds.size === 0 && joinIdsToDelete.size === 0 && deletablePorts.length === 0) {
        return false;
      }

      this.host.dispatch(new DeleteCommand([...sel.cellIds], [...joinIdsToDelete], deletablePorts));
      this.host.setSelection(SelectionState.empty());
      return true;
    }

    const delta = ARROW_DELTA[key];
    if (delta) {
      const sel = this.host.getSelection();
      if (sel.cellIds.size === 0) return false;
      this.host.dispatch(new MoveCellsCommand([...sel.cellIds], delta[0], delta[1]));
      return true;
    }

    // 外部仕様6.8.2: 「すべて選択」（Ctrl+A / Cmd+A）
    if ((mods.ctrl || mods.meta) && !mods.shift && (key === "a" || key === "A")) {
      const doc = this.host.getDocument();
      if (doc.cellCount === 0) return false;
      this.host.setSelection(SelectionState.ofCells(doc.cellValues().map((c) => c.id)));
      return true;
    }

    if (
      key === "Escape" &&
      (this.state.kind === "joining" || this.state.kind === "movingJoinBar" || this.state.kind === "movingPorts")
    ) {
      if (this.state.kind === "movingJoinBar") this.sink.clearJoinBarPreview();
      this.transition({ kind: "idle" });
      this.host.requestRender();
      return true;
    }

    void mods;
    return false;
  }

  /** 選択中のポートを、所属辺に沿ってドラッグ量だけ動かす（外部仕様4.3.2）。辺と直交する成分は捨てる。 */
  private movePortsCommand(start: Point, end: Point): Command | undefined {
    const doc = this.host.getDocument();
    const moves = [];
    for (const p of this.host.getSelection().ports) {
      const cell = doc.getCell(p.cellId);
      const port = p.kind === "cport" ? cell?.findCPort(p.portName, p.subscript) : cell?.findEPort(p.portName, p.subscript);
      if (!cell || !port) continue;
      const alongX = port.edgeSide === "TOP" || port.edgeSide === "BOTTOM";
      const delta = alongX ? end.x - start.x : end.y - start.y;
      if (delta === 0) continue;
      moves.push({
        cellId: p.cellId,
        kind: p.kind === "cport" ? ("CPort" as const) : ("EPort" as const),
        name: p.portName,
        subscript: p.subscript,
        offset: port.offset + delta,
      });
    }
    return moves.length > 0 ? new MovePortsCommand(moves) : undefined;
  }

  /** ポートを、ポインタに最も近いセルの辺へ付け替える（外部仕様4.3.2「所属辺の変更」）。 */
  private edgeChangeCommand(anchor: SelectedPort, end: Point): Command | undefined {
    const cell = this.host.getDocument().getCell(anchor.cellId);
    if (!cell) return undefined;
    const distances: readonly (readonly [EdgeSide, number])[] = [
      ["TOP", Math.abs(end.y - cell.y)],
      ["BOTTOM", Math.abs(end.y - (cell.y + cell.height))],
      ["LEFT", Math.abs(end.x - cell.x)],
      ["RIGHT", Math.abs(end.x - (cell.x + cell.width))],
    ];
    const edge = distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
    const offset = edge === "TOP" || edge === "BOTTOM" ? end.x - cell.x : end.y - cell.y;
    return new ChangePortEdgeCommand(
      anchor.cellId,
      anchor.kind === "cport" ? "CPort" : "EPort",
      anchor.portName,
      edge,
      offset,
      anchor.subscript,
    );
  }

  /** 結合作成ドラッグ中の仮結線（描画ループが参照する、外部仕様6.4.2）。 */
  currentJoinPreview(): JoinPreviewLine | undefined {
    const s = this.state;
    if (s.kind !== "joining" || !this.lastModelPoint) return undefined;
    const cell = this.host.getDocument().getCell(s.from.cellId);
    const port = cell?.cports.find(
      (p) => p.name === s.from.portName && p.subscript === s.from.subscript,
    );
    if (!cell || !port) return undefined;
    return { from: portPosition(cell, port), to: this.lastModelPoint };
  }

  private signatureMatches(from: PortRef, hit: Extract<HitResult, { kind: "eport" }>): boolean {
    const doc = this.host.getDocument();
    const source = doc.getCell(from.cellId);
    const cport = source?.cports.find(
      (p) => p.name === from.portName && p.subscript === from.subscript,
    );
    const target = doc.getCell(hit.cellId);
    const eport = target?.eports.find((p) => p.name === hit.portName);
    return cport !== undefined && eport !== undefined && cport.signature === eport.signature;
  }

  /**
   * 外部仕様 3.7 / 6.4.1: ポインタ直下の要素・操作状態に応じたカーソル形状を算出する。
   * - 通常（空白等）: "default"
   * - 呼び口の上（アイドル時）: 未結合なら結合開始可能な形状 "crosshair"、結合済みなら "pointer"
   * - 受け口の上（アイドル時）: "pointer"
   * - 結合操作中: "crosshair"（操作中）、シグニチャ一致受け口の上なら "pointer"（結合先として有効）
   * - セルの上: "move"（ドラッグ移動可能）
   * - 結合バーの上: 水平バーなら "ns-resize"、垂直バーなら "ew-resize"
   * - 新規セル配置モード: "crosshair"
   */
  computeCursor(point: Point): string {
    const s = this.state;
    if (s.kind === "joining") {
      const hit = this.hitTester().hitTest(point);
      if (hit.kind === "eport" && this.signatureMatches(s.from, hit)) {
        return "pointer";
      }
      return "crosshair";
    }

    if (s.kind === "movingCells" || s.kind === "movingPorts") {
      return "move";
    }

    if (s.kind === "movingJoinBar") {
      return s.axis === "y" ? "ns-resize" : "ew-resize";
    }

    if (s.kind === "boxSelect") {
      return "crosshair";
    }

    if (this.host.getMode() === "newCell") {
      return "crosshair";
    }

    const hit = this.hitTester().hitTest(point);
    if (hit.kind === "cport") {
      const cell = this.host.getDocument().getCell(hit.cellId);
      const cport = cell?.cports.find((p) => p.name === hit.portName && p.subscript === hit.subscript);
      if (cport && cport.joinId === null) {
        return "crosshair";
      }
      return "pointer";
    }

    if (hit.kind === "eport") {
      return "pointer";
    }

    if (hit.kind === "joinBar") {
      const doc = this.host.getDocument();
      const join = doc.getJoin(hit.joinId);
      const bar = join?.bars[hit.barIndex];
      if (join && bar && hit.barIndex > 0 && hit.barIndex < join.bars.length - 1) {
        return bar.direction === "H" ? "ns-resize" : "ew-resize";
      }
      return "pointer";
    }

    if (hit.kind === "cell") {
      return "move";
    }

    return "default";
  }

  // --- DOMイベントの結線（renderer プロセスでのみ呼ぶ） ---

  /**
   * `<svg>` 要素とウィンドウにマウス・キーのリスナを張り、上のポインタ操作へ委譲する。
   * 返り値は解除関数。
   */
  attach(svg: SVGSVGElement): () => void {
    const toModel = (e: MouseEvent): Point => {
      const rect = svg.getBoundingClientRect();
      return this.sink.screenToModel(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        this.host.getView(),
      );
    };
    const modsOf = (e: MouseEvent | KeyboardEvent): Mods => ({
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      alt: e.altKey,
    });

    const updateCursor = (p: Point): void => {
      if (svg.style.cursor === "grab" || svg.style.cursor === "grabbing") return;
      svg.style.cursor = this.computeCursor(p);
    };

    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      const pt = toModel(e);
      this.pointerDown(pt, modsOf(e));
      updateCursor(pt);
    };
    const onMove = (e: MouseEvent): void => {
      const pt = toModel(e);
      this.pointerMove(pt);
      updateCursor(pt);
    };
    const onUp = (e: MouseEvent): void => {
      const pt = toModel(e);
      this.pointerUp(pt);
      updateCursor(pt);
    };
    const onMouseLeave = (): void => {
      if (svg.style.cursor !== "grab" && svg.style.cursor !== "grabbing") {
        svg.style.cursor = "";
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (this.keyDown(e.key, modsOf(e))) e.preventDefault();
    };
    const onContextMenu = (e: Event): void => e.preventDefault();

    svg.addEventListener("mousedown", onDown);
    svg.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    svg.addEventListener("contextmenu", onContextMenu);

    return () => {
      svg.removeEventListener("mousedown", onDown);
      svg.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      svg.removeEventListener("contextmenu", onContextMenu);
    };
  }
}

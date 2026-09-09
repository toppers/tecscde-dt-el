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
import { pxPerMm, SelectionState, type CanvasView } from "./view";
import type { JoinPreviewLine } from "./svg-renderer";
import { ALIGN_MM, alignRound } from "../model/align";
import { moveBarBars, portPosition } from "../model/geometry";
import type { Point } from "../model/geometry";
import type { Cell } from "../model/cell";
import type { Bar, Join } from "../model/join";
import type { CellId, JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";
import { Command } from "../commands/command";
import {
  AddCellCommand,
  CreateJoinCommand,
  DeleteCommand,
  MoveCellsCommand,
  MoveJoinBarCommand,
} from "../commands";

/** 修飾キーの状態。DOM `MouseEvent`/`KeyboardEvent` から抜き出した最小集合。 */
export interface Mods {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
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
      if (hit.kind === "none" && celltypeName) {
        this.host.dispatch(new AddCellCommand(celltypeName, point.x, point.y));
      }
      return;
    }

    if (hit.kind === "cport") {
      const cell = doc.getCell(hit.cellId);
      const port = cell?.cports.find((p) => p.name === hit.portName && p.subscript === hit.subscript);
      if (port && port.joinId === null) {
        this.transition({
          kind: "joining",
          from: { cellId: hit.cellId, portName: hit.portName, subscript: hit.subscript },
        });
      } else {
        // 既に結合済みの呼び口はハイライトのみ（結合モードには入らない、外部仕様6.4.1）。
        this.host.setSelection(SelectionState.empty());
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
      this.host.setSelection(SelectionState.ofJoin(hit.joinId));
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

    // hit.kind === "eport" | "none": 空白クリック → 矩形選択の開始。
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
   */
  keyDown(key: string, mods: Mods = NO_MODS): boolean {
    if (key === "Delete" || key === "Backspace") {
      const sel = this.host.getSelection();
      if (sel.isEmpty) return false;
      this.host.dispatch(new DeleteCommand([...sel.cellIds], [...sel.joinIds]));
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

    if (key === "Escape" && (this.state.kind === "joining" || this.state.kind === "movingJoinBar")) {
      if (this.state.kind === "movingJoinBar") this.sink.clearJoinBarPreview();
      this.transition({ kind: "idle" });
      this.host.requestRender();
      return true;
    }

    void mods;
    return false;
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
    });

    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      this.pointerDown(toModel(e), modsOf(e));
    };
    const onMove = (e: MouseEvent): void => this.pointerMove(toModel(e));
    const onUp = (e: MouseEvent): void => this.pointerUp(toModel(e));
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (this.keyDown(e.key, modsOf(e))) e.preventDefault();
    };
    const onContextMenu = (e: Event): void => e.preventDefault();

    svg.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    svg.addEventListener("contextmenu", onContextMenu);

    return () => {
      svg.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      svg.removeEventListener("contextmenu", onContextMenu);
    };
  }
}

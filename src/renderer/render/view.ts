// [[TECSCDE-DT-EL内部仕様]] 第5章5.4節 — 描画層（モジュールE）が読み取る表示状態と、
// 選択状態を表す小さな値クラス。
//
// 選択状態はモデル（第3章）の一部ではなく描画層に閉じた一時的なUI状態であり、
// `.cde` には保存されない（挙動の正典: [[TECSCDE内部仕様]] 6.5節）。
// `TecscdeDocument` とは別の型にすることで、この境界を型システムでも表現する。
//
// 完全な `ViewState` クラス（ズーム/パン/グリッド/フィルタ/検索の集約）は第6章
// （表示制御）で定義される。本章の描画・ヒットテストが実際に読み取るのは下記の
// `CanvasView` に列挙したフィールドだけであり、第6章の `ViewState` はこの interface を
// 満たすアダプタを提供する（描画層は第6章のクラス実体に依存しない）。

import type { Point } from "../model/geometry";
import type { CellId, JoinId, RegionId } from "../model/ids";

/** モデル座標 1mm あたりの基準ピクセル数（ズーム100%時、外部仕様3.2.1）。 */
export const MM_TO_PX = 96 / 25.4;

/** 描画層がキャンバスの投影のために読み取る最小の面。第6章 `ViewState` が実装する。 */
export interface CanvasView {
  /** 1.0 = 100%（外部仕様3.2.1: 5%〜200%）。 */
  readonly zoom: number;
  /** グリッド線の表示（既定 false、第6章6.2節）。 */
  readonly gridVisible: boolean;
  /** 結合のシグニチャ名ラベルの表示（第6章6.5節 `DisplayFilters`）。 */
  readonly showSignatureNames: boolean;
  /** セル名強調（外部仕様7.4.2）: オンでセル名を大きく表示し、セルタイプ名を隠す。 */
  readonly emphasizeCellName: boolean;
  /** 非表示リージョンに属するセルのID集合（第6章6.5節）。空なら全表示。 */
  readonly hiddenRegionIds: ReadonlySet<RegionId>;
  /** リージョンごとの色（第6B章6B.3）。`null` は色分けなし。根には色が無い。 */
  readonly regionColors: ReadonlyMap<RegionId, string> | null;
}

// 実行時の投影は第6章の `ViewState.toCanvasView(regions)` が担う（モジュールF）。
// これはそのフィルタ無し・ズーム100%の既定値であり、`ViewState.initial()` の射影と一致する。
export function defaultCanvasView(): CanvasView {
  return { zoom: 1, gridVisible: false, showSignatureNames: true, emphasizeCellName: false, hiddenRegionIds: new Set(), regionColors: null };
}

/** モデル座標(mm)1つあたりの画面ピクセル数。 */
export function pxPerMm(view: CanvasView): number {
  return MM_TO_PX * view.zoom;
}

/** 画面ピクセル距離をモデル座標(mm)の距離へ換算する。 */
export function pxToMm(view: CanvasView, px: number): number {
  return px / pxPerMm(view);
}

/** ラバーバンド選択などで使う軸並行矩形（モデル座標）。 */
export interface Rect {
  readonly a: Point;
  readonly b: Point;
}

/** 同名ポートと配列要素を区別する、選択用の参照。 */
export interface SelectedPort {
  readonly kind: "cport" | "eport";
  readonly cellId: CellId;
  readonly portName: string;
  readonly subscript: number | null;
}

function samePort(a: SelectedPort, b: SelectedPort): boolean {
  return a.kind === b.kind && a.cellId === b.cellId && a.portName === b.portName && a.subscript === b.subscript;
}

/**
 * 選択集合（セル・結合、または同一セル内のポート）。不変。空の選択は `SelectionState.empty()`。
 * 移動・削除・コピーのコマンド（第4章）は、この一時集合をそのまま対象に取れる
 * （[[TECSCDE内部仕様]] 6.5節）。
 */
export class SelectionState {
  private constructor(
    readonly cellIds: ReadonlySet<CellId>,
    readonly joinIds: ReadonlySet<JoinId>,
    readonly ports: readonly SelectedPort[] = [],
  ) {}

  static empty(): SelectionState {
    return new SelectionState(new Set(), new Set());
  }

  static ofCells(ids: Iterable<CellId>): SelectionState {
    return new SelectionState(new Set(ids), new Set());
  }

  static ofJoin(id: JoinId): SelectionState {
    return new SelectionState(new Set(), new Set([id]));
  }

  static ofPort(port: SelectedPort): SelectionState {
    return new SelectionState(new Set(), new Set(), [port]);
  }

  get isEmpty(): boolean {
    return this.cellIds.size === 0 && this.joinIds.size === 0 && this.ports.length === 0;
  }

  hasCell(id: CellId): boolean {
    return this.cellIds.has(id);
  }

  hasJoin(id: JoinId): boolean {
    return this.joinIds.has(id);
  }

  hasPort(port: SelectedPort): boolean {
    return this.ports.some((selected) => samePort(selected, port));
  }

  /** ポート選択はセル・結合と排他。同じ所有セルのポートだけを追加する。 */
  withPortAdded(port: SelectedPort): SelectionState {
    if (this.hasPort(port)) return this;
    const ports = this.ports[0]?.cellId === port.cellId ? [...this.ports, port] : [port];
    return new SelectionState(new Set(), new Set(), ports);
  }

  withPortToggled(port: SelectedPort): SelectionState {
    if (!this.hasPort(port)) return this.withPortAdded(port);
    return new SelectionState(new Set(), new Set(), this.ports.filter((selected) => !samePort(selected, port)));
  }

  /** Ctrl+クリック相当: 既に入っていれば外し、なければ加える（結合選択はクリアする）。 */
  withCellToggled(id: CellId): SelectionState {
    const next = new Set(this.cellIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return new SelectionState(next, new Set());
  }

  /** Shift+クリック相当: セルを追加する（既存のセル選択は保つ）。 */
  withCellAdded(id: CellId): SelectionState {
    const next = new Set(this.cellIds);
    next.add(id);
    return new SelectionState(next, new Set());
  }

  /** Ctrl+クリック相当: 既に入っていれば外し、なければ加える（セル・ポート選択はクリアする）。 */
  withJoinToggled(id: JoinId): SelectionState {
    const next = new Set(this.joinIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return new SelectionState(new Set(), next);
  }

  /** Shift+クリック相当: 結合を追加する（既存の結合選択は保つ、セル・ポート選択はクリアする）。 */
  withJoinAdded(id: JoinId): SelectionState {
    const next = new Set(this.joinIds);
    next.add(id);
    return new SelectionState(new Set(), next);
  }
}

// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— アプリ状態の中央ストア。
// [[TECSCDE-実装アーキテクチャ案]]の「C+F+H を束ねる中央 pub/sub ストア」に相当する。
//
// 保持するのは編集履歴（`History`, モジュールD）・表示状態（`ViewState`, モジュールF）・
// 選択（`SelectionState`, モジュールE）・入力モード・編集対象ファイルパス・保存済みマーカ
// （DirtyTracker 相当, 第7章7.3節）・読み込み時の診断（モジュールB）。すべて不変値で持ち、
// 更新は差し替え＋購読者通知。このモジュールは renderer プロセスで完結し、`electron` へは
// 触れない（gateways 経由のみ）。

import { History } from "../commands/history";
import type { Command } from "../commands/command";
import { CopyCommand, CutCommand, PasteCommand } from "../commands";
import {
  DiagnosticsCollector,
  DiagnosticReport,
  checkIntegrity,
  type Diagnostic,
} from "../diagnostics";
import { serializeCellsAsCdl } from "../cdl/fragment";
import type { Cell } from "../model/cell";
import type { CellId } from "../model/ids";
import { TecscdeDocument } from "../model/document";
import { SelectionState } from "../render/view";
import { ViewState } from "../view-state/view-state";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";

export type InputMode = "select" | "newCell";

export type StoreListener = () => void;

export class AppStore {
  private historyState: History;
  private viewState: ViewState = ViewState.initial();
  private selectionState: SelectionState = SelectionState.empty();
  private mode: InputMode = "select";
  private activeCelltype: string | undefined;
  private path: string | null = null;
  /** 直近の保存時点での `history.past.length`。dirty 判定の基準（7.3節 DirtyTracker）。 */
  private savedAtPastLength = 0;
  /** モジュールB がロード時に出した一過性の診断。編集では再導出されないので保持する。 */
  private loadDiagnostics: readonly Diagnostic[] = [];
  /**
   * 第4章4.1節: アプリ内クリップボード（コピー時点のCellスナップショット）。
   * OSクリップボードと並行して保持し、貼り付け時はこちらを優先する（外部仕様6.7.2）。
   */
  private appClipboard: readonly Cell[] = [];
  /**
   * 第9章9.5節: 今回のセッションで参照専用として読み込んだファイルの実パス。
   * `TecscdeDocument.referenceFiles`はbasenameのみ保持するため（8.2.2）、
   * `TecsgenCommandBuilder`が実際に`execFile`へ渡せる形はここでのみ保持する。
   */
  private referenceFilePaths: readonly string[] = [];
  /** 第9章9.4節: 直近のtecsgen実行結果から変換した診断。次のGenerateまで保持する。 */
  private tecsgenDiagnostics: readonly Diagnostic[] = [];
  /** 第9章9.5節: 二重起動防止（実行中はツールバーのGenerateボタンを無効化する）。 */
  private generating = false;
  private readonly listeners = new Set<StoreListener>();

  constructor(
    initial: TecscdeDocument = TecscdeDocument.empty(),
    loadDiagnostics: readonly Diagnostic[] = [],
  ) {
    this.historyState = History.begin(initial);
    this.loadDiagnostics = loadDiagnostics;
  }

  // --- 読み取り ---

  get history(): History {
    return this.historyState;
  }

  getDocument(): TecscdeDocument {
    return this.historyState.current;
  }

  get view(): ViewState {
    return this.viewState;
  }

  get selection(): SelectionState {
    return this.selectionState;
  }

  getMode(): InputMode {
    return this.mode;
  }

  getActiveCelltypeName(): string | undefined {
    return this.activeCelltype;
  }

  get filePath(): string | null {
    return this.path;
  }

  /** 第9章9.5節: `TecsgenCommandBuilder`が参照専用ファイルの実パスとして使う。 */
  getReferenceFilePaths(): readonly string[] {
    return this.referenceFilePaths;
  }

  get isGenerating(): boolean {
    return this.generating;
  }

  get canUndo(): boolean {
    return this.historyState.canUndo;
  }

  get canRedo(): boolean {
    return this.historyState.canRedo;
  }

  isDirty(): boolean {
    return this.historyState.past.length !== this.savedAtPastLength;
  }

  /**
   * 現在の診断レポート（モジュールH）。ロード時の一過性診断（モジュールB）と、
   * 現在のドキュメント状態から再導出する整合性チェック（`checkIntegrity`）を集約する。
   * 派生値なので購読通知は持たず、`render()` から都度呼ばれる（`checkIntegrity` は
   * O(セル数＋import数)で軽い）。tecsgen 実行結果（9.4節）が実装されたらここに積む。
   */
  getReport(): DiagnosticReport {
    const collector = new DiagnosticsCollector();
    collector.reportAll(this.loadDiagnostics);
    collector.reportAll(checkIntegrity(this.getDocument()));
    collector.reportAll(this.tecsgenDiagnostics);
    return collector.toReport();
  }

  // --- 更新（すべて通知を伴う） ---

  /** 新しいコマンドを確定する（Undo で戻せる）。適用不能なら History が doc を素通しする。 */
  dispatch(command: Command): void {
    this.historyState = this.historyState.commit(command);
    this.notify();
  }

  /**
   * 第4章4.1節: 選択セルをアプリ内クリップボードへスナップショットし、OSクリップボードへも
   * CDL断片として書き込む。`CopyCommand`は履歴を作らない特殊なコマンドのため`dispatch()`を
   * 経由せず`apply()`を直接1回だけ呼ぶ（[[TECSCDE-DT-EL PasteCommand非同期クリップボード決定]]）。
   */
  copySelection(clipboard: Pick<ClipboardGateway, "writeText">): void {
    const ids = [...this.selectionState.cellIds];
    if (ids.length === 0) return;
    const doc = this.getDocument();
    this.appClipboard = this.snapshotCells(doc, ids);
    new CopyCommand(ids, clipboard).apply(doc);
  }

  /**
   * 第4章4.1節: コピーと同じスナップショット＋OS書き込みを行った上で、カスケード削除を
   * 1つのUndo単位として確定する。クリップボード書き込みは`CutCommand.apply()`の中では行わない
   * （history.commit()により繰り返し再生されるため。clipboard-commands.tsのファイル冒頭参照）。
   */
  cutSelection(clipboard: Pick<ClipboardGateway, "writeText">): void {
    const cellIds = [...this.selectionState.cellIds];
    const joinIds = [...this.selectionState.joinIds];
    if (cellIds.length === 0 && joinIds.length === 0) return;
    const doc = this.getDocument();
    this.appClipboard = this.snapshotCells(doc, cellIds);
    void clipboard.writeText(serializeCellsAsCdl(doc, cellIds));
    this.dispatch(new CutCommand(cellIds, joinIds));
    this.setSelection(SelectionState.empty());
  }

  /**
   * 第4章4.1節: アプリ内クリップボードを優先し、空の場合のみOSクリップボードのCDL断片を試みる。
   * OSクリップボードの読み取り自体は非同期のため、呼び出し側（モジュールG）が
   * `ClipboardGateway.readText()`を先に解決してから渡す。
   */
  pasteClipboard(osClipboardText: string | undefined): void {
    this.dispatch(new PasteCommand(this.appClipboard, osClipboardText));
  }

  private snapshotCells(doc: TecscdeDocument, ids: readonly CellId[]): readonly Cell[] {
    return ids.flatMap((id) => {
      const cell = doc.getCell(id);
      return cell ? [cell] : [];
    });
  }

  undo(): void {
    if (!this.historyState.canUndo) return;
    this.historyState = this.historyState.undo();
    this.notify();
  }

  redo(): void {
    if (!this.historyState.canRedo) return;
    this.historyState = this.historyState.redo();
    this.notify();
  }

  setView(view: ViewState): void {
    if (view === this.viewState) return;
    this.viewState = view;
    this.notify();
  }

  setSelection(selection: SelectionState): void {
    this.selectionState = selection;
    this.notify();
  }

  setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.notify();
  }

  setActiveCelltype(name: string | undefined): void {
    if (name === this.activeCelltype) return;
    this.activeCelltype = name;
    this.notify();
  }

  /** ファイル読み込み後、履歴・選択・dirty マーカ・ロード診断をまとめて初期化する。 */
  loadDocument(
    document: TecscdeDocument,
    path: string | null,
    loadDiagnostics: readonly Diagnostic[] = [],
    referenceFilePaths: readonly string[] = [],
  ): void {
    this.historyState = History.begin(document);
    this.selectionState = SelectionState.empty();
    this.path = path;
    this.savedAtPastLength = 0;
    this.loadDiagnostics = loadDiagnostics;
    this.referenceFilePaths = referenceFilePaths;
    // 前のファイルのtecsgen実行結果は、読み込んだ別ファイルには対応しないため破棄する。
    this.tecsgenDiagnostics = [];
    this.notify();
  }

  /** 第9章9.5節: Generate実行の開始／終了。ツールバーの二重起動防止に使う。 */
  setGenerating(generating: boolean): void {
    if (generating === this.generating) return;
    this.generating = generating;
    this.notify();
  }

  /** 第9章9.4節: `TecsgenResultParser.parse()`の結果を反映する。`getReport()`へ合流する。 */
  setTecsgenDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.tecsgenDiagnostics = diagnostics;
    this.notify();
  }

  /** 保存が成功したときに呼ぶ。以後 `isDirty()` は false になる（次の編集まで）。 */
  markSaved(path: string): void {
    this.savedAtPastLength = this.historyState.past.length;
    this.path = path;
    this.notify();
  }

  // --- 購読 ---

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

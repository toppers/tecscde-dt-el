// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— アプリ状態の中央ストア。
// [[TECSCDE-実装アーキテクチャ案]]の「C+F+H を束ねる中央 pub/sub ストア」に相当する。
//
// 保持するのは編集履歴（`History`, モジュールD）・表示状態（`ViewState`, モジュールF）・
// 選択（`SelectionState`, モジュールE）・入力モード・編集対象ファイルパス・保存済みマーカ
// （DirtyTracker 相当, 第7章7.3節）・読み込み時の診断（モジュールB）。すべて不変値で持ち、
// 更新は差し替え＋購読者通知。このモジュールは renderer プロセスで完結し、`electron` へは
// 触れない（gateways 経由のみ）。

import { isUnderAny } from "../../shared/path-under";
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
import { emptyPortTypeIndex, type PortTypeIndex } from "../cdl/port-type-index";
import type { Cell } from "../model/cell";
import type { CellId } from "../model/ids";
import { TecscdeDocument } from "../model/document";
import { SelectionState } from "../render/view";
import { ViewState } from "../view-state/view-state";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";
import type { GeneratedCdlFile } from "../../shared/ipc-types.js";

export type InputMode = "select" | "newCell";

export type StoreListener = () => void;

export class AppStore {
  private historyState: History;
  private savedDocument: TecscdeDocument;
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
  /** 第9章9.5節: `TecsgenCommandBuilder`が参照専用ファイルの実パスとして使う。 */
  private referenceFilePaths: readonly string[] = [];
  /** 第7C章7.7.4節: .tecsgen-opts等から与えられた追加のインポート探索パス。 */
  private extraImportPaths: readonly string[] = [];
  private optionsFilePath: string | undefined;
  /** 第3章3.2節: `.tecsgen-opts`の`-S`で指定されたシステム定義ディレクトリ（絶対パス）。 */
  private systemDirs: readonly string[] = [];
  /** 第3章3.2節: `settings.json`の`allowEditSystemDefined`。起動時に一度読む。 */
  private allowEditSystemDefined = false;
  private generatedTypeSources: readonly GeneratedCdlFile[] = [];
  private portTypeIndex: PortTypeIndex = emptyPortTypeIndex();
  /**
   * 第7C章7.7.2節（#8）: 参照ファイルの生CDLテキスト（パス→内容）。`addAsReference`が
   * 新規参照を1件追加するたびeditable＋全referencesを合わせて再パースする必要があり、
   * 既存参照をディスクから再取得せずに済ませるためのキャッシュ。
   */
  private referenceSources: ReadonlyMap<string, string> = new Map();
  /** 第9章9.4節: 直近のtecsgen実行結果から変換した診断。次のGenerateまで保持する。 */
  private tecsgenDiagnostics: readonly Diagnostic[] = [];
  /**
   * 第9C章9C.5節: 起動時のtecsgenの版の確認による診断。ドキュメントの読み込みや
   * Generateの結果の差し替えでは消えない（`tecsgenDiagnostics`とは別に持つ）。
   */
  private environmentDiagnostics: readonly Diagnostic[] = [];
  /** 第9章9.5節: 二重起動防止（実行中はツールバーのGenerateボタンを無効化する）。 */
  private generating = false;
  private readonly listeners = new Set<StoreListener>();

  constructor(
    initial: TecscdeDocument = TecscdeDocument.empty(),
    loadDiagnostics: readonly Diagnostic[] = [],
  ) {
    this.historyState = History.begin(initial);
    this.savedDocument = initial;
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

  /** 第7C章7.7.4節: 追加のインポート探索パスを取得する。 */
  getExtraImportPaths(): readonly string[] {
    return this.extraImportPaths;
  }

  getSystemDirs(): readonly string[] {
    return this.systemDirs;
  }

  getAllowEditSystemDefined(): boolean {
    return this.allowEditSystemDefined;
  }

  setAllowEditSystemDefined(allow: boolean): void {
    this.allowEditSystemDefined = allow;
  }

  /**
   * 第3章3.2節: 編集対象（主ファイル）が`-S`のディレクトリ配下にあり、既定どおり閲覧のみか。
   * 閲覧のみのときは編集可能なセルが無く、保存すると中身が失われるため、保存を行わない。
   */
  isEditingFileReadOnlySystemDefined(): boolean {
    return !this.allowEditSystemDefined && this.path !== null && isUnderAny(this.path, this.systemDirs);
  }

  getOptionsFilePath(): string | undefined {
    return this.optionsFilePath;
  }

  getGeneratedTypeSources(): readonly GeneratedCdlFile[] {
    return this.generatedTypeSources;
  }

  getPortTypeIndex(): PortTypeIndex {
    return this.portTypeIndex;
  }

  /** 第7C章7.7.2節（#8）: 参照ファイルの生CDLテキストのキャッシュ（パス→内容）。 */
  getReferenceSources(): ReadonlyMap<string, string> {
    return this.referenceSources;
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

  isSourceDirty(sourcePath: string): boolean {
    const snapshot = (document: TecscdeDocument): string => {
      const cells = document.cellValues().filter((cell) => cell.locale === sourcePath).map((cell) => ({
        name: cell.name,
        celltypeName: cell.celltypeName,
        x: cell.x, y: cell.y, width: cell.width, height: cell.height,
        regionId: cell.regionId,
        attrs: cell.attrs,
        ports: [...cell.cports, ...cell.eports].map((port) => ({
          name: port.name, signature: port.signature, edgeSide: port.edgeSide,
          offset: port.offset, subscript: port.subscript, arraySize: port.arraySize,
        })),
      }));
      const joins = document.joinValues().filter((join) =>
        document.getCell(join.cellId)?.locale === sourcePath).map((join) => ({
          join,
          targetName: document.getCell(join.eportCellId)?.name,
        }));
      return JSON.stringify({ cells, joins });
    };
    return snapshot(this.getDocument()) !== snapshot(this.savedDocument);
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
    collector.reportAll(this.environmentDiagnostics);
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
    const selectedIds = [...this.selectionState.cellIds];
    const selectedCell = selectedIds.length === 1 ? this.getDocument().getCell(selectedIds[0]!) : undefined;
    const targetSource = selectedCell?.editable && selectedCell.locale && this.getDocument().sourceTemplates.has(selectedCell.locale)
      ? selectedCell.locale : undefined;
    this.dispatch(new PasteCommand(this.appClipboard, osClipboardText, targetSource));
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
    referenceSources: ReadonlyMap<string, string> = new Map(),
    extraImportPaths: readonly string[] = [],
    optionsFilePath?: string,
    generatedTypeSources: readonly GeneratedCdlFile[] = [],
    portTypeIndex: PortTypeIndex = emptyPortTypeIndex(),
    keepDirty = false,
    systemDirs: readonly string[] = [],
  ): void {
    this.historyState = History.begin(document);
    if (!keepDirty) this.savedDocument = document;
    this.selectionState = SelectionState.empty();
    this.path = path;
    this.savedAtPastLength = keepDirty ? -1 : 0;
    this.loadDiagnostics = loadDiagnostics;
    this.referenceSources = referenceSources;
    this.referenceFilePaths = referenceFilePaths;
    this.extraImportPaths = extraImportPaths;
    this.optionsFilePath = optionsFilePath;
    this.systemDirs = systemDirs;
    this.generatedTypeSources = generatedTypeSources;
    this.portTypeIndex = portTypeIndex;
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

  /** 第9C章9C.5節: 起動時のtecsgenの版の確認の結果を反映する。`getReport()`へ合流する。 */
  setEnvironmentDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.environmentDiagnostics = diagnostics;
    this.notify();
  }

  /** 保存が成功したときに呼ぶ。以後 `isDirty()` は false になる（次の編集まで）。 */
  markSaved(path: string): void {
    this.savedAtPastLength = this.historyState.past.length;
    this.savedDocument = this.getDocument();
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

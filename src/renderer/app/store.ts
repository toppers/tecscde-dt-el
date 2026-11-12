// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— アプリ状態の中央ストア。
// [[TECSCDE-実装アーキテクチャ案]]の「C+F+H を束ねる中央 pub/sub ストア」に相当する。
//
// 保持するのは編集履歴（`History`, モジュールD）・表示状態（`ViewState`, モジュールF）・
// 選択（`SelectionState`, モジュールE）・入力モード・編集対象ファイルパス・保存済みマーカ
// （DirtyTracker 相当, 第7章7.3節）・読み込み時の診断（モジュールB）。すべて不変値で持ち、
// 更新は差し替え＋購読者通知。このモジュールは renderer プロセスで完結し、`electron` へは
// 触れない（gateways 経由のみ）。

import { sourceSaveState } from "./source-save-state";
import type { TecsgenInfo } from "./about-info";
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
import type { GeneratedCdlFile, SessionSnapshot } from "../../shared/ipc-types.js";

export type InputMode = "select" | "newCell";

export type StoreListener = () => void;

export interface LoadGuard {
  readonly requestGeneration: number;
  readonly documentEpoch: number;
  readonly revision: number;
}

export interface SaveTicket {
  readonly id: number;
  readonly documentEpoch: number;
  readonly historyNodeId: number;
  readonly key: string | null;
  readonly locationGeneration: number;
  readonly expectedPath: string | null;
  readonly state: string;
  readonly content: string;
}

export class AppStore {
  private historyState: History;
  private readonly savedStates = new Map<string | null, string>();
  private viewState: ViewState = ViewState.initial();
  private selectionState: SelectionState = SelectionState.empty();
  private mode: InputMode = "select";
  private activeCelltype: string | undefined;
  private path: string | null = null;
  /** 7J: source checkpoints track successful writes independently of history depth. */
  private readonly savedSequences = new Map<string | null, number>();
  private readonly savedWriteSequences = new Map<string, number>();
  private saveSequence = 0;
  private locationGeneration = 0;
  documentEpoch = 0;
  documentRevision = 0;
  private requestGeneration = 0;
  private closing = false;
  private readonly pendingSaves = new Set<Promise<unknown>>();
  private saveAsTail: Promise<void> | undefined;
  private readonly resumeWaiters: (() => void)[] = [];
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
  private tecsgenDiagnosticsRevision: number | undefined;
  private toolSettingsRevision = -1;
  /**
   * 第9C章9C.5節: 起動時のtecsgenの版の確認による診断。ドキュメントの読み込みや
   * Generateの結果の差し替えでは消えない（`tecsgenDiagnostics`とは別に持つ）。
   */
  private environmentDiagnostics: readonly Diagnostic[] = [];
  private tecsgenStatus = { version: "未確認", command: "未確認" };
  /** 外部仕様3.8: 起動時の tecsgen の確認で分かったこと。確認が終わるまでは未設定。 */
  private tecsgenInfo: TecsgenInfo | undefined;
  private exportDiagnostics: readonly Diagnostic[] = [];
  private logWriteWarning: Diagnostic | undefined;
  /** 自動配置し直したときに収まらなかったセルの警告（外部仕様7.3.x）。別のファイルを読み込むと消える。 */
  private autoLayoutDiagnostics: readonly Diagnostic[] = [];
  /** 第9章9.5節: 二重起動防止（実行中はツールバーのGenerateボタンを無効化する）。 */
  private generating = false;
  /** 第6C章6C.3節: 結合強調モード（監査#46）。 */
  private connectionFocusEnabled = false;
  /** 第6C章6C.4節: コマンド実行に伴う診断（Undoで解除、Redoで再構成）。ノードIDキーで保持。 */
  private historyDiagnostics = new Map<number, readonly Diagnostic[]>();
  /** コマンド確定を伴わない操作由来の診断（配置不能など）。次の編集や文書読込で解除。 */
  private transientActionDiagnostics: readonly Diagnostic[] = [];
  private readonly listeners = new Set<StoreListener>();

  constructor(
    initial: TecscdeDocument = TecscdeDocument.empty(),
    loadDiagnostics: readonly Diagnostic[] = [],
  ) {
    this.historyState = History.begin(initial);
    for (const key of this.sourceKeys()) this.savedStates.set(key, sourceSaveState(initial, key));
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

  isConnectionFocusEnabled(): boolean {
    return this.connectionFocusEnabled;
  }

  toggleConnectionFocus(): void {
    this.connectionFocusEnabled = !this.connectionFocusEnabled;
    this.notify();
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

  getSessionSnapshot(): SessionSnapshot {
    const originalPrimary = this.getDocument().editingFileName;
    return { editablePath: this.path, referencePaths: [...this.referenceFilePaths],
      extraImportPaths: [...this.extraImportPaths],
      ...(this.optionsFilePath ? { optionsFilePath: this.optionsFilePath } : {}),
      sourceOrder: [...new Set([
        ...this.getDocument().sourceOrder.map((key) => key === originalPrimary && this.path ? this.path : key),
        ...this.referenceFilePaths,
        ...(this.path ? [this.path] : []),
      ])],
    };
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
    return this.sourceKeys().some((key) => this.isSourceDirty(key));
  }

  private sourceKeys(): (string | null)[] {
    return [...new Set([this.getDocument().editingFileName ?? null, ...this.getDocument().sourceTemplates.keys()])];
  }

  isSourceDirty(sourcePath: string | null): boolean {
    return sourceSaveState(this.getDocument(), sourcePath) !== this.savedStates.get(sourcePath);
  }

  beginLoad(): LoadGuard {
    return { requestGeneration: ++this.requestGeneration, documentEpoch: this.documentEpoch, revision: this.documentRevision };
  }

  isLoadCurrent(guard: LoadGuard): boolean {
    return guard.requestGeneration === this.requestGeneration && guard.documentEpoch === this.documentEpoch &&
      guard.revision === this.documentRevision;
  }

  async canApplyLoad(guard: LoadGuard): Promise<boolean> {
    if (this.closing) await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    return this.isLoadCurrent(guard) && !this.closing;
  }

  get isClosing(): boolean { return this.closing; }

  async prepareClose(): Promise<void> {
    this.closing = true;
    while (this.pendingSaves.size > 0) await Promise.allSettled([...this.pendingSaves]);
  }

  cancelClose(): void {
    this.closing = false;
    for (const resume of this.resumeWaiters.splice(0)) resume();
  }

  trackSave<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("終了確認中は保存できません。"));
    const pending = operation();
    this.pendingSaves.add(pending);
    void pending.finally(() => this.pendingSaves.delete(pending)).catch(() => {});
    return pending;
  }

  enqueueSaveAs(operation: () => Promise<void>): Promise<void> {
    const epoch = this.documentEpoch;
    return this.trackSave(() => {
      const start = () => epoch === this.documentEpoch ? operation() : Promise.resolve();
      const pending = this.saveAsTail ? this.saveAsTail.then(start) : start();
      const tail = pending.then(() => {}, () => {});
      this.saveAsTail = tail;
      void tail.then(() => { if (this.saveAsTail === tail) this.saveAsTail = undefined; });
      return pending;
    });
  }

  createSaveTicket(key: string | null, content: string): SaveTicket {
    return Object.freeze({ id: ++this.saveSequence, documentEpoch: this.documentEpoch,
      historyNodeId: this.history.nodeId, key, locationGeneration: this.locationGeneration,
      expectedPath: key === (this.getDocument().editingFileName ?? null) ? this.path : key,
      state: sourceSaveState(this.getDocument(), key), content });
  }

  canSaveTicket(ticket: SaveTicket): boolean {
    const primary = ticket.key === (this.getDocument().editingFileName ?? null);
    return ticket.documentEpoch === this.documentEpoch &&
      (!primary || ticket.locationGeneration === this.locationGeneration) &&
      ticket.expectedPath === (primary ? this.path : ticket.key);
  }

  recordSaved(ticket: SaveTicket, destination: string, saveAs = false, writeSequence?: number): boolean {
    if (!this.canSaveTicket(ticket) ||
        (writeSequence === undefined && ticket.id <= (this.savedSequences.get(ticket.key) ?? 0))) return false;
    const primary = ticket.key === (this.getDocument().editingFileName ?? null);
    if (ticket.expectedPath !== (primary ? this.path : ticket.key)) return false;
    if (writeSequence !== undefined && writeSequence <= (this.savedWriteSequences.get(destination) ?? 0)) return false;
    if (writeSequence !== undefined) this.savedWriteSequences.set(destination, writeSequence);
    this.savedStates.set(ticket.key, ticket.state);
    this.savedSequences.set(ticket.key, ticket.id);
    if (saveAs && primary) {
      this.path = destination;
      this.locationGeneration++;
      this.documentRevision++;
    }
    this.notify();
    return true;
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
    const activeHistoryDiags = this.historyDiagnostics.get(this.history.nodeId);
    if (activeHistoryDiags) collector.reportAll(activeHistoryDiags);
    collector.reportAll(this.transientActionDiagnostics);
    collector.reportAll(this.exportDiagnostics);
    if (this.logWriteWarning) collector.report(this.logWriteWarning);
    collector.reportAll(this.autoLayoutDiagnostics);
    return collector.toReport();
  }

  setCommandDiagnostics(historyNodeId: number, diagnostics: readonly Diagnostic[]): void {
    this.historyDiagnostics.set(historyNodeId, diagnostics);
    this.transientActionDiagnostics = [];
    this.notify();
  }

  setTransientActionDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.transientActionDiagnostics = diagnostics;
    this.notify();
  }

  // --- 更新（すべて通知を伴う） ---

  /** 新しいコマンドを確定する（Undo で戻せる）。適用不能なら History が doc を素通しする。 */
  dispatch(command: Command): void {
    if (this.closing) return;
    this.transientActionDiagnostics = [];
    const previous = this.historyState;
    this.historyState = this.historyState.commit(command);
    if (this.historyState !== previous) this.documentRevision++;
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
    if (this.closing || !this.historyState.canUndo) return;
    this.historyState = this.historyState.undo();
    this.documentRevision++;
    this.notify();
  }

  redo(): void {
    if (this.closing || !this.historyState.canRedo) return;
    this.historyState = this.historyState.redo();
    this.documentRevision++;
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
    const previousPrimary = this.getDocument().editingFileName ?? null;
    const nextPrimary = document.editingFileName ?? null;
    if (keepDirty && previousPrimary !== nextPrimary && this.savedStates.has(previousPrimary)) {
      this.savedStates.set(nextPrimary, this.savedStates.get(previousPrimary)!);
      this.savedStates.delete(previousPrimary);
    }
    this.historyState = History.begin(document);
    if (!keepDirty) this.documentEpoch++;
    this.documentRevision++;
    if (!keepDirty) { this.savedStates.clear(); this.savedSequences.clear(); }
    for (const key of this.sourceKeys()) {
      if (!this.savedStates.has(key)) this.savedStates.set(key, sourceSaveState(document, key));
    }
    this.selectionState = SelectionState.empty();
    this.path = path;

    this.loadDiagnostics = loadDiagnostics;
    this.referenceSources = referenceSources;
    this.referenceFilePaths = referenceFilePaths;
    this.extraImportPaths = extraImportPaths;
    this.optionsFilePath = optionsFilePath;
    this.systemDirs = systemDirs;
    this.generatedTypeSources = generatedTypeSources;
    this.portTypeIndex = portTypeIndex;
    this.historyDiagnostics.clear();
    this.transientActionDiagnostics = [];
    // 前のファイルのtecsgen実行結果は、読み込んだ別ファイルには対応しないため破棄する。
    this.tecsgenDiagnostics = [];
    this.autoLayoutDiagnostics = [];
    // 第6B章6B.7: 非表示にしたリージョンのIDは前のドキュメントのものなので、別のファイルを開くときは
    // 戻す（参照ファイルの追加＝keepDirtyでは保つ）。色分け・シグニチャ名の切り替えは保つ。
    if (!keepDirty) this.viewState = this.viewState.withFilters(this.viewState.filters.withAllRegionsShown());
    this.notify();
  }

  /** 第9章9.5節: Generate実行の開始／終了。ツールバーの二重起動防止に使う。 */
  setGenerating(generating: boolean): void {
    if (generating === this.generating) return;
    this.generating = generating;
    this.notify();
  }

  /** 第9章9.4節: `TecsgenResultParser.parse()`の結果を反映する。`getReport()`へ合流する。 */
  setTecsgenDiagnostics(diagnostics: readonly Diagnostic[], revision?: number): void {
    if (revision !== undefined && revision < this.toolSettingsRevision) return;
    this.tecsgenDiagnostics = diagnostics;
    this.tecsgenDiagnosticsRevision = revision;
    this.notify();
  }

  /** 外部仕様3.8: バージョン情報ダイアログ用に、tecsgen の版と使われた起動コマンドを保持する。 */
  setTecsgenInfo(info: TecsgenInfo): void {
    this.tecsgenInfo = info;
  }

  getTecsgenInfo(): TecsgenInfo | undefined {
    return this.tecsgenInfo;
  }

  /** 第9C章9C.5節: 起動時のtecsgenの版の確認の結果を反映する。`getReport()`へ合流する。 */
  setEnvironmentDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.environmentDiagnostics = diagnostics;
    this.notify();
  }

  /**
   * 監査#66: ログ書き込み失敗などの起動中環境警告を重複なく追加する。
   */
  addEnvironmentDiagnostic(diagnostic: Diagnostic): void {
    if (this.environmentDiagnostics.some((d) => d.code === diagnostic.code && d.message === diagnostic.message)) return;
    this.environmentDiagnostics = [...this.environmentDiagnostics, diagnostic];
    this.notify();
  }

  setToolSettingsRevision(revision: number): void {
    if (revision <= this.toolSettingsRevision) return;
    this.toolSettingsRevision = revision;
    if (this.tecsgenDiagnosticsRevision === undefined || this.tecsgenDiagnosticsRevision < revision) {
      this.tecsgenDiagnostics = this.tecsgenDiagnostics.filter((entry) =>
        entry.code !== "E-TECSGEN-NOT-FOUND" && entry.code !== "E-TECSGEN-LAUNCH-FAILED");
    }
  }

  replaceTecsgenEnvironmentDiagnostics(diagnostics: readonly Diagnostic[], revision?: number): void {
    const belongsToTecsgen = (entry: Diagnostic): boolean => entry.code.startsWith("W-TECSGEN-VERSION-") ||
      entry.code === "E-TECSGEN-NOT-FOUND" || entry.code === "E-TECSGEN-LAUNCH-FAILED";
    this.environmentDiagnostics = [...this.environmentDiagnostics.filter((entry) => !belongsToTecsgen(entry)), ...diagnostics];
    if (revision === undefined || this.tecsgenDiagnosticsRevision === undefined || this.tecsgenDiagnosticsRevision < revision) {
      this.tecsgenDiagnostics = this.tecsgenDiagnostics.filter((entry) => !belongsToTecsgen(entry));
    }
    this.notify();
  }

  getTecsgenStatus(): { readonly version: string; readonly command: string } { return this.tecsgenStatus; }

  setTecsgenStatus(version: string, command: string): void {
    this.tecsgenStatus = { version, command };
    this.notify();
  }

  /** 外部仕様9.5.2の規定13: ログを書けないときの警告。ドキュメントを読み込み直しても残る。 */
  setLogWriteWarning(diagnostic: Diagnostic): void {
    this.logWriteWarning = diagnostic;
    this.notify();
  }

  /** 外部仕様7.3.x: 自動配置し直した結果の警告（用紙に収まらなかったセル）。空を渡すと消す。 */
  setAutoLayoutDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.autoLayoutDiagnostics = diagnostics;
    // 読み込み時に出した同じ警告は、今回の結果で置き換える（古い件数を残さない）。
    this.loadDiagnostics = this.loadDiagnostics.filter((d) => d.code !== "W-AUTO-LAYOUT-OVERFLOW");
    this.notify();
  }

  /** 7F章: 直近のエクスポート失敗だけを診断一覧に保持する。 */
  setExportDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.exportDiagnostics = diagnostics;
    this.notify();
  }

  /** 保存が成功したときに呼ぶ。以後 `isDirty()` は false になる（次の編集まで）。 */
  markSaved(path: string): void {
    for (const key of this.sourceKeys()) this.savedStates.set(key, sourceSaveState(this.getDocument(), key));
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

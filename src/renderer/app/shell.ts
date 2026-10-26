// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— 最小 UI シェル。
//
// index.html が用意した DOM（ツールバー・スクロールコンテナ内の <svg>・ステータスバー）を
// 受け取り、モジュールE（`SvgRenderer`/`GestureController`）・F（`ViewState`）・
// D（`History` 経由の `AppStore.dispatch`）を配線する。ここが `SvgRenderer`/
// `GestureController`/`ViewState` を初めて実 DOM 上で動かす層である
// （[[TECSCDE-DT-EL実装]] 「次のステップ」）。
//
// スコープ: キャンバス・save/saveAs・ファイルブラウザ経由のopen・Undo/Redo・ズーム・グリッド・ステータスバー・
// キーボード・Copy/Cut/Paste、およびモジュールG次段のパレット／プロパティパネル／
// 検索ボックス／ナビゲータパネル／診断パネル（2026-09-11・09-12、各パネルは専用クラスへ委譲する）。

import { GestureController } from "../render/gesture-controller";
import { SvgRenderer } from "../render/svg-renderer";
import type { Point } from "../model/geometry";
import type { PaperOrientation, PaperSize } from "../model/paper";
import { ChangePaperCommand } from "../commands";
import type { TecscdeDocument } from "../model/document";
import { ZOOM_STEP } from "../view-state/view-state";
import type { FileGateway } from "../gateways/file-gateway";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import type { WindowGateway } from "../gateways/window-gateway";
import { AppGestureHost } from "./gesture-host";
import { addAsReference, baseName, loadOptionsFile, newDocument, openFromPath, save, saveAs } from "./file-actions";
import { FileBrowserView } from "./file-browser-panel";
import { pasteFromClipboard } from "./clipboard-actions";
import { generate, tecsgenCommandLine } from "./tecsgen-actions";
import { panCenterFromScroll, scrollForPanCenter } from "./pan-scroll";
import { PaletteView } from "./palette";
import { CelltypeDetailsView } from "./celltype-details";
import { PanelVisibilityView } from "./panel-visibility";
import { alignSelection, canAlign } from "./align-actions";
import { regionStatusText } from "./status-region";
import { RegionFilterPanel } from "./region-filter-panel";
import { RegionLegendView } from "./region-legend";
import { PropertyPanelView } from "./property-panel";
import { SearchBoxView } from "./search-box";
import { searchDocument } from "../view-state/search";
import { SvgExporter, type SvgExportRange } from "../export/svg-exporter";
import { PngExporter, PngExportTooLargeError, type PngScale } from "../export/png-exporter";
import type { ExportFormat, PdfPage } from "../../shared/ipc-types";
import type { CellId, JoinId } from "../model/ids";
import { NavigatorView } from "./navigator-panel";
import { DiagnosticsPanelView } from "./diagnostics-panel";
import type { AppStore } from "./store";

const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface AppShellOptions {
  /** 要素の探索起点（Electron では document、テストでは差し込んだ DOM）。 */
  readonly root: ParentNode;
  readonly store: AppStore;
  readonly gateway: FileGateway;
  /** 第4章4.1節: Copy/Cut/PasteのOSクリップボード連携。 */
  readonly clipboard: ClipboardGateway;
  /** 第9章9.5節: tecsgenの「実行(Generate)」操作。 */
  readonly tecsgen: TecsgenGateway;
  /** 第7章7.9節: 未保存かどうかをmain（CloseGuard）へ知らせる。省略時は通知しない（テスト用）。 */
  readonly windowGateway?: Pick<WindowGateway, "setDirty">;
  /** window 相当（キーボード・スクロールの結線先）。既定は globalThis の window。 */
  readonly win?: Window;
}

function requireEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`AppShell: 要素が見つかりません: ${selector}`);
  return el;
}

export class AppShell {
  private readonly store: AppStore;
  private readonly gateway: FileGateway;
  private readonly clipboard: ClipboardGateway;
  private readonly tecsgen: TecsgenGateway;
  private readonly windowGateway: Pick<WindowGateway, "setDirty"> | undefined;
  private readonly win: Window;

  private readonly svg: SVGSVGElement;
  private readonly scrollEl: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly paperSelect: HTMLSelectElement;
  /** 第6B章6B.6: 表示制御バーの切り替え（色分け・シグニチャ名）。 */
  private readonly filterColor: HTMLInputElement;
  private readonly filterSignature: HTMLInputElement;
  private readonly filterEmphasize: HTMLInputElement;
  private readonly statusPos: HTMLElement;
  private readonly statusZoom: HTMLElement;
  private readonly statusFile: HTMLElement;
  private readonly statusRegion: HTMLElement;
  private readonly exportDialog: HTMLElement;
  private readonly exportFormat: HTMLSelectElement;
  private readonly exportRange: HTMLSelectElement;
  private readonly pngScaleField: HTMLElement;
  private readonly pngScale: HTMLSelectElement;
  private readonly exportConfirm: HTMLButtonElement;

  private readonly renderer: SvgRenderer;
  /** ドラッグ FSM。DOM 結線は `attach` 済み。テストはこの公開メソッドを直接叩ける。 */
  readonly gesture: GestureController;

  /** モジュールG次段（外部仕様3.3〜3.5節）。各パネルは自身のDOM配線・描画を持つ。 */
  private readonly palette: PaletteView;
  private readonly celltypeDetails: CelltypeDetailsView;
  private readonly panelVisibility: PanelVisibilityView;
  private readonly regionFilter: RegionFilterPanel;
  private readonly regionLegend: RegionLegendView;
  private readonly propertyPanel: PropertyPanelView;
  private readonly searchBox: SearchBoxView;
  private readonly navigator: NavigatorView;
  private readonly diagnosticsPanel: DiagnosticsPanelView;
  private readonly fileBrowser: FileBrowserView;

  private readonly disposers: Array<() => void> = [];

  /** render() が発火させたスクロール書き込みを scroll ハンドラが無視するためのフラグ。 */
  private applyingScroll = false;
  /** scroll ハンドラ由来の setView で、続く render() のスクロール同期を1回だけ抑止する。 */
  private suppressScrollSync = false;
  private spaceHeld = false;
  private panDragLast: Point | undefined;
  private exportBusy = false;

  constructor(opts: AppShellOptions) {
    this.store = opts.store;
    this.gateway = opts.gateway;
    this.clipboard = opts.clipboard;
    this.tecsgen = opts.tecsgen;
    this.windowGateway = opts.windowGateway;
    this.win = opts.win ?? (globalThis as unknown as { window: Window }).window;

    const { root } = opts;
    this.svg = requireEl<SVGSVGElement>(root, "#canvas");
    this.scrollEl = requireEl<HTMLElement>(root, "#canvas-scroll");
    this.toolbar = requireEl<HTMLElement>(root, "#toolbar");
    this.zoomSlider = requireEl<HTMLInputElement>(root, "#zoom-slider");
    this.paperSelect = requireEl<HTMLSelectElement>(root, "#paper-select");
    this.filterColor = requireEl<HTMLInputElement>(root, "#filter-color");
    this.filterSignature = requireEl<HTMLInputElement>(root, "#filter-signature");
    this.filterEmphasize = requireEl<HTMLInputElement>(root, "#filter-emphasize");
    this.statusPos = requireEl<HTMLElement>(root, "#status-pos");
    this.statusZoom = requireEl<HTMLElement>(root, "#status-zoom");
    this.statusFile = requireEl<HTMLElement>(root, "#status-file");
    this.statusRegion = requireEl<HTMLElement>(root, "#status-region");
    this.exportDialog = requireEl<HTMLElement>(root, "#export-dialog");
    this.exportFormat = requireEl<HTMLSelectElement>(root, "#export-format");
    this.exportRange = requireEl<HTMLSelectElement>(root, "#export-range");
    this.pngScaleField = requireEl<HTMLElement>(root, "#png-scale-field");
    this.pngScale = requireEl<HTMLSelectElement>(root, "#png-scale");
    this.exportConfirm = requireEl<HTMLButtonElement>(root, "#export-confirm");

    this.renderer = new SvgRenderer(this.svg);
    const host = new AppGestureHost(
      this.store,
      () => this.render(),
      (p) => this.updateStatusPos(p),
    );
    this.gesture = new GestureController(this.renderer, host);

    this.celltypeDetails = new CelltypeDetailsView(requireEl<HTMLDialogElement>(root, "#celltype-details-dialog"));
    this.palette = new PaletteView(requireEl<HTMLElement>(root, "#palette"), this.store, (name, trigger) => {
      const celltype = this.store.getDocument().getCelltype(name);
      if (celltype) this.celltypeDetails.open(celltype, trigger);
    });
    this.regionFilter = new RegionFilterPanel(requireEl<HTMLElement>(root, "#region-filter"), this.store);
    this.regionLegend = new RegionLegendView(requireEl<HTMLElement>(root, "#region-legend"), this.store);
    this.propertyPanel = new PropertyPanelView(requireEl<HTMLElement>(root, "#property-panel"), this.store);
    this.searchBox = new SearchBoxView(requireEl<HTMLElement>(root, "#search-box"), this.store);
    this.navigator = new NavigatorView(requireEl<HTMLElement>(root, "#navigator"), this.store, this.scrollEl);
    this.diagnosticsPanel = new DiagnosticsPanelView(
      requireEl<HTMLButtonElement>(root, "#status-diag"),
      requireEl<HTMLElement>(root, "#diagnostics-panel"),
      this.store,
    );
    this.fileBrowser = new FileBrowserView(
      requireEl<HTMLElement>(root, "#file-browser"),
      this.store,
      this.gateway,
      (path) =>
        void openFromPath(this.store, this.gateway, this.tecsgen, path).catch((err: unknown) =>
          this.reportActionError("openFolder", err),
        ),
      (path) =>
        void addAsReference(this.store, this.gateway, this.tecsgen, path).catch((err: unknown) =>
          this.reportActionError("addAsReference", err),
        ),
      (path) =>
        void loadOptionsFile(this.store, this.gateway, this.tecsgen, path).catch((err: unknown) =>
          this.reportActionError("loadOptionsFile", err),
        ),
    );
    this.panelVisibility = new PanelVisibilityView(root, () => this.render());
  }

  /** 配線を張り、初回描画する。返り値でなく `dispose()` で解除する。 */
  start(): void {
    this.disposers.push(this.store.subscribe(() => this.render()));
    this.disposers.push(this.gesture.attach(this.svg));
    this.bindToolbar();
    this.bindExportDialog();
    this.bindZoomSlider();
    this.bindPaperSelect();
    this.bindDisplayBar();
    this.disposers.push(() => this.regionFilter.dispose());
    this.disposers.push(() => this.panelVisibility.dispose());
    this.disposers.push(() => this.palette.dispose());
    this.disposers.push(() => this.celltypeDetails.dispose());
    this.bindKeyboard();
    this.bindSpacePan();
    this.bindWheel();
    this.bindScroll();
    this.bindDirtyReport();
    // 7.6.6節: 記憶済みのルートフォルダがあれば起動時に一度だけ自動復元する。
    this.gateway.onRestoreFileBrowserRoot((path) =>
      void this.fileBrowser.restoreRoot(path).catch((err: unknown) => this.reportActionError("restoreFileBrowserRoot", err)),
    );
    this.render();
  }

  /** 診断パネルを開く（起動時のtecsgenの版の警告など、利用者の操作によらない診断を見せるため）。 */
  openDiagnostics(): void {
    this.diagnosticsPanel.open();
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  // --- 描画ループ ---

  render(): void {
    const doc = this.store.getDocument();
    const view = this.store.view;
    const canvasView = view.toCanvasView(doc.regions);
    const hits = searchDocument(doc, view.searchQuery, canvasView.hiddenRegionIds);
    const cellIds = new Set<CellId>();
    const joinIds = new Set<JoinId>();
    for (const hit of hits) {
      if (hit.kind === "cell") cellIds.add(hit.cellId);
      else joinIds.add(hit.joinId);
    }
    this.renderer.render(doc, canvasView, this.store.selection, {
      joinPreview: this.gesture.currentJoinPreview(),
      searchHighlights: { cellIds, joinIds },
    });
    this.syncScrollFromPan(doc);
    this.refreshToolbarState();
    this.refreshStatus();
    this.palette.render();
    this.regionFilter.render();
    this.regionLegend.render();
    this.propertyPanel.render();
    this.searchBox.render(hits);
    this.navigator.render();
    this.diagnosticsPanel.render();
    this.fileBrowser.render();
  }

  private syncScrollFromPan(doc: TecscdeDocument): void {
    if (this.suppressScrollSync) {
      this.suppressScrollSync = false;
      return;
    }
    const k = this.store.view.pxPerMm;
    if (!Number.isFinite(k) || k <= 0) return;
    const { width, height } = doc.paper.contentSize();
    const viewport = { width: this.scrollEl.clientWidth, height: this.scrollEl.clientHeight };
    const content = { width: width * k, height: height * k };
    const { left, top } = scrollForPanCenter(k, this.store.view.panCenter, viewport, content);
    this.applyingScroll = true;
    this.scrollEl.scrollLeft = left;
    this.scrollEl.scrollTop = top;
    this.applyingScroll = false;
  }

  // --- ツールバー ---

  private bindToolbar(): void {
    const onClick = (e: Event): void => {
      const target = e.target as HTMLElement | null;
      const action = target?.closest<HTMLElement>("[data-action]")?.dataset["action"];
      if (!action) return;
      this.runAction(action);
    };
    this.toolbar.addEventListener("click", onClick);
    this.disposers.push(() => this.toolbar.removeEventListener("click", onClick));
  }

  /** ツールバー／キーボード共通のコマンド入口。 */
  runAction(action: string): void {
    switch (action) {
      case "openFolder":
        void this.fileBrowser.chooseRoot().catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "save":
        void save(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "saveAs":
        void saveAs(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "exportDiagram":
        if (this.exportBusy) break;
        this.exportDialog.hidden = false;
        this.exportFormat.value = "svg";
        this.exportRange.value = "paper";
        this.pngScale.value = "2";
        this.pngScaleField.hidden = true;
        this.exportFormat.focus();
        break;
      case "clear":
        void newDocument(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "alignTop":
        alignSelection(this.store, "top");
        break;
      case "alignLeft":
        alignSelection(this.store, "left");
        break;
      case "undo":
        this.store.undo();
        break;
      case "redo":
        this.store.redo();
        break;
      case "zoomReset":
        this.store.setView(this.store.view.resetZoom());
        break;
      case "toggleGrid":
        this.store.setView(this.store.view.toggleGrid());
        break;
      case "toggleNavigator":
        this.navigator.toggle();
        break;
      case "searchNext":
        this.searchBox.next();
        break;
      case "searchPrev":
        this.searchBox.prev();
        break;
      case "generate":
        void generate(this.store, this.gateway, this.tecsgen)
          .then(() => this.diagnosticsPanel.open())
          .catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "copyTecsgenCommand":
        this.copyTecsgenCommand();
        break;
      default:
        break;
    }
  }

  /**
   * ツールバー由来の非同期操作（fire-and-forget）が失敗した際、コンソールへ記録する。
   * 対処せず投げっぱなしだと、失敗が画面上は完全に無音のまま消える
   * （実機確認で判明: WASM CSPエラー・clipboard未定義エラーがいずれもこの形で埋もれていた）。
   */
  private reportActionError(action: string, err: unknown): void {
    console.error(`[AppShell] action "${action}" failed:`, err);
  }

  private bindExportDialog(): void {
    const cancel = requireEl<HTMLButtonElement>(this.exportDialog, "#export-cancel");
    const onCancel = (): void => { this.exportDialog.hidden = true; };
    const onConfirm = (): void => { void this.exportDiagram(); };
    const onFormat = (): void => { this.pngScaleField.hidden = this.exportFormat.value !== "png"; };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Tab") {
        const first = this.exportFormat;
        const last = this.exportConfirm;
        if (event.shiftKey && this.win.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && this.win.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      // ダイアログ表示中に背後の編集ショートカットへ伝えない。
      event.stopPropagation();
    };
    const onWindowKey = (event: KeyboardEvent): void => {
      if (this.exportDialog.hidden || this.exportDialog.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") onCancel();
    };
    cancel.addEventListener("click", onCancel);
    this.exportConfirm.addEventListener("click", onConfirm);
    this.exportFormat.addEventListener("change", onFormat);
    this.exportDialog.addEventListener("keydown", onKey);
    this.win.addEventListener("keydown", onWindowKey, true);
    this.disposers.push(() => {
      cancel.removeEventListener("click", onCancel);
      this.exportConfirm.removeEventListener("click", onConfirm);
      this.exportFormat.removeEventListener("change", onFormat);
      this.exportDialog.removeEventListener("keydown", onKey);
      this.win.removeEventListener("keydown", onWindowKey, true);
    });
  }

  private async exportDiagram(): Promise<void> {
    if (this.exportBusy) return;
    this.exportBusy = true;
    this.exportConfirm.disabled = true;
    const doc = this.store.getDocument();
    const view = this.store.view.toCanvasView(doc.regions);
    const range = this.exportRange.value as SvgExportRange;
    const format = this.exportFormat.value as ExportFormat;
    const scale = Number(this.pngScale.value) as PngScale;
    const title = this.store.filePath ? baseName(this.store.filePath) : "untitled";
    const suggestedName = `${title.replace(/\.[^.]+$/, "")}.${format}`;
    this.exportDialog.hidden = true;
    try {
      const path = await this.gateway.chooseExportPath(format, suggestedName);
      if (!path) return;
      const result = SvgExporter.build(doc, view, range, title);
      if (format === "pdf") {
        const page: PdfPage = result.range === "paper"
          ? { kind: "paper", size: doc.paper.size, orientation: doc.paper.orientation }
          : { kind: "custom", widthMm: result.widthMm, heightMm: result.heightMm };
        await this.gateway.exportPdf(path, result.svg, page);
      } else {
        const data = format === "svg" ? result.svg : await PngExporter.rasterize(result, scale);
        await this.gateway.export(path, data);
      }
      this.store.setExportDiagnostics([]);
    } catch (err: unknown) {
      this.reportActionError("exportDiagram", err);
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof PngExportTooLargeError ? "E-EXPORT-TOO-LARGE" : "E-EXPORT-FAILED";
      this.store.setExportDiagnostics([{ severity: "error", code, message }]);
      this.diagnosticsPanel.open();
    } finally {
      this.exportBusy = false;
      this.exportConfirm.disabled = false;
    }
  }

  /** 外部仕様8.4.2: 実行に加えて、生成コマンドの提示・コピー経路も残す。 */
  private copyTecsgenCommand(): void {
    void tecsgenCommandLine(this.store, this.gateway)
      .then((commandLine) => {
        if (commandLine) return this.clipboard.writeText(commandLine);
      })
      .catch((err: unknown) => this.reportActionError("copyTecsgenCommand", err));
  }

  private zoomBy(factor: number, anchor?: Point): void {
    const a = anchor ?? this.store.view.panCenter;
    this.store.setView(this.store.view.zoomAt(a, factor));
  }

  /**
   * スライダ用: 絶対倍率（比率、1.0=100%）へ変更する。アンカー省略で`zoomBy`が
   * 既定として使う`panCenter`（表示中央のモデル座標）がそのまま使われるため、
   * 外部仕様7.1.2「倍率変更時は表示中央を保つ」を満たす。
   */
  private zoomTo(targetZoom: number): void {
    const current = this.store.view.zoom;
    if (current <= 0) return;
    this.zoomBy(targetZoom / current);
  }

  private bindZoomSlider(): void {
    const onInput = (): void => {
      const percent = Number(this.zoomSlider.value);
      if (!Number.isFinite(percent) || percent <= 0) return;
      this.zoomTo(percent / 100);
    };
    this.zoomSlider.addEventListener("input", onInput);
    this.disposers.push(() => this.zoomSlider.removeEventListener("input", onInput));
  }

  private bindPaperSelect(): void {
    const onChange = (): void => {
      if (this.store.isEditingFileReadOnlySystemDefined()) return;
      const [size, orientation] = this.paperSelect.value.split(":") as [PaperSize, PaperOrientation];
      if (!(["A4", "A3", "A2"] as string[]).includes(size) ||
          !(["LANDSCAPE", "PORTRAIT"] as string[]).includes(orientation)) return;
      const paper = this.store.getDocument().paper;
      if (size === paper.size && orientation === paper.orientation) return;
      this.store.dispatch(new ChangePaperCommand(size, orientation));
    };
    this.paperSelect.addEventListener("change", onChange);
    this.disposers.push(() => this.paperSelect.removeEventListener("change", onChange));
  }

  /** 第6B章6B.6・6B.7: 表示制御バーの2つのチェックを `DisplayFilters` に結ぶ。 */
  private bindDisplayBar(): void {
    const onColor = (): void => {
      const f = this.store.view.filters;
      this.store.setView(this.store.view.withFilters(f.withColorByRegion(this.filterColor.checked)));
    };
    const onSignature = (): void => {
      const f = this.store.view.filters;
      this.store.setView(this.store.view.withFilters(f.withShowSignatureNames(this.filterSignature.checked)));
    };
    const onEmphasize = (): void => {
      const f = this.store.view.filters;
      this.store.setView(this.store.view.withFilters(f.withEmphasizeCellName(this.filterEmphasize.checked)));
    };
    this.filterColor.addEventListener("change", onColor);
    this.filterSignature.addEventListener("change", onSignature);
    this.filterEmphasize.addEventListener("change", onEmphasize);
    this.disposers.push(() => {
      this.filterColor.removeEventListener("change", onColor);
      this.filterSignature.removeEventListener("change", onSignature);
      this.filterEmphasize.removeEventListener("change", onEmphasize);
    });
  }

  private refreshToolbarState(): void {
    this.setDisabled("[data-action='undo']", !this.store.canUndo);
    this.setDisabled("[data-action='redo']", !this.store.canRedo);
    // 外部仕様7.3.2: 整列は複数選択で、実際に動くセルがあるときだけ有効。
    this.setDisabled("[data-action='alignTop']", !canAlign(this.store, "top"));
    this.setDisabled("[data-action='alignLeft']", !canAlign(this.store, "left"));
    const canGenerate = this.store.filePath !== null && !this.store.isGenerating;
    this.setDisabled("[data-action='generate']", !canGenerate);
    this.setDisabled("[data-action='copyTecsgenCommand']", this.store.filePath === null);
    // 外部仕様3.2.1: スライダはボタン・ホイール・キーボードいずれのズーム変更にも追従する。
    this.zoomSlider.value = String(Math.round(this.store.view.zoom * 100));
    const paper = this.store.getDocument().paper;
    this.paperSelect.value = `${paper.size}:${paper.orientation}`;
    this.paperSelect.disabled = this.store.isEditingFileReadOnlySystemDefined();
    // 第6B章6B.6: 表示制御バーのチェックは常に `DisplayFilters` の状態に従う。
    const filters = this.store.view.filters;
    this.filterColor.checked = filters.colorByRegion;
    this.filterSignature.checked = filters.showSignatureNames;
    this.filterEmphasize.checked = filters.emphasizeCellName;
  }

  private setDisabled(selector: string, disabled: boolean): void {
    const el = this.toolbar.querySelector<HTMLButtonElement>(selector);
    if (el) el.disabled = disabled;
  }

  // --- ステータスバー ---

  private refreshStatus(): void {
    this.statusZoom.textContent = `${Math.round(this.store.view.zoom * 100)}%`;
    // 外部仕様4.9.2: 選択したセルの所属リージョンをステータス表示に示す。
    this.statusRegion.textContent = regionStatusText(this.store.getDocument(), this.store.selection);
    const path = this.store.filePath;
    const dirty = path !== null && this.store.isDirty();
    this.statusFile.textContent = path ? `${baseName(path)}${dirty ? " ● 未保存の変更" : ""}` : "(未保存)";
    // 末尾の記号だけでは見落とされやすい（実機確認で判明）ため、太字/色でも示す。
    this.statusFile.classList.toggle("dirty", dirty);
    // 診断の件数表示・一覧パネル・ジャンプ機構は `DiagnosticsPanelView`（8.4節）が持つ。
  }

  private updateStatusPos(p: Point | undefined): void {
    this.statusPos.textContent = p ? `x:${p.x.toFixed(1)} y:${p.y.toFixed(1)} mm` : "";
  }

  // --- キーボード・ホイール・スクロール ---

  private bindKeyboard(): void {
    const onKey = (e: KeyboardEvent): void => {
      // External spec 7.4.2: clear search even while the search input has focus.
      // Keep selection and filters, and let gestures also handle Escape.
      if (e.key === "Escape" && !e.isComposing && this.store.view.searchQuery !== null) {
        e.preventDefault();
        this.store.setView(this.store.view.withSearchQuery(null));
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && TEXT_INPUT_TAGS.has(t.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      switch (e.key.toLowerCase()) {
        case "z":
          e.preventDefault();
          if (e.shiftKey) this.store.redo();
          else this.store.undo();
          break;
        case "y":
          e.preventDefault();
          this.store.redo();
          break;
        case "s":
          e.preventDefault();
          void save(this.store, this.gateway);
          break;
        case "c":
          e.preventDefault();
          this.store.copySelection(this.clipboard);
          break;
        case "x":
          e.preventDefault();
          this.store.cutSelection(this.clipboard);
          break;
        case "v":
          e.preventDefault();
          void pasteFromClipboard(this.store, this.clipboard);
          break;
        case "=":
        case "+":
          e.preventDefault();
          this.zoomBy(ZOOM_STEP);
          break;
        case "-":
        case "_":
          e.preventDefault();
          this.zoomBy(1 / ZOOM_STEP);
          break;
        case "0":
          e.preventDefault();
          this.store.setView(this.store.view.resetZoom());
          break;
        default:
          break;
      }
    };
    this.win.addEventListener("keydown", onKey);
    this.disposers.push(() => this.win.removeEventListener("keydown", onKey));
  }

  /** 外部仕様7.1.2: スペースを押している間は左ドラッグで表示を移動する。 */
  private bindSpacePan(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey ||
          (target && (TEXT_INPUT_TAGS.has(target.tagName) || target.isContentEditable ||
            target.closest("button, a, [role='button']")))) return;
      e.preventDefault();
      this.spaceHeld = true;
      this.svg.style.cursor = "grab";
    };
    const stop = (): void => {
      this.spaceHeld = false;
      this.panDragLast = undefined;
      this.svg.style.cursor = "";
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === "Space") stop();
    };
    const onDown = (e: MouseEvent): void => {
      if (!this.spaceHeld || e.button !== 0 || this.gesture.stateKind !== "idle") return;
      e.preventDefault();
      e.stopPropagation();
      this.panDragLast = { x: e.clientX, y: e.clientY };
      this.svg.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent): void => {
      const last = this.panDragLast;
      if (!last) return;
      this.panDragLast = { x: e.clientX, y: e.clientY };
      const k = this.store.view.pxPerMm;
      if (!Number.isFinite(k) || k <= 0) return;
      const next = this.store.view.panBy({
        x: (last.x - e.clientX) / k,
        y: (last.y - e.clientY) / k,
      });
      const viewport = { width: this.scrollEl.clientWidth, height: this.scrollEl.clientHeight };
      const paper = this.store.getDocument().paper.contentSize();
      const scroll = scrollForPanCenter(k, next.panCenter, viewport, {
        width: paper.width * k,
        height: paper.height * k,
      });
      this.store.setView(next.panTo(panCenterFromScroll(k, scroll, viewport)));
    };
    const onUp = (e: MouseEvent): void => {
      if (e.button !== 0 || !this.panDragLast) return;
      this.panDragLast = undefined;
      this.svg.style.cursor = this.spaceHeld ? "grab" : "";
    };
    this.win.addEventListener("keydown", onKeyDown);
    this.win.addEventListener("keyup", onKeyUp);
    this.win.addEventListener("blur", stop);
    this.svg.addEventListener("mousedown", onDown, true);
    this.win.addEventListener("mousemove", onMove);
    this.win.addEventListener("mouseup", onUp);
    this.disposers.push(() => {
      stop();
      this.win.removeEventListener("keydown", onKeyDown);
      this.win.removeEventListener("keyup", onKeyUp);
      this.win.removeEventListener("blur", stop);
      this.svg.removeEventListener("mousedown", onDown, true);
      this.win.removeEventListener("mousemove", onMove);
      this.win.removeEventListener("mouseup", onUp);
    });
  }

  private bindWheel(): void {
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return; // プレーンホイールはスクロールコンテナの既定動作
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const canvasView = this.store.view.toCanvasView(this.store.getDocument().regions);
      const anchor = this.renderer.screenToModel(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        canvasView,
      );
      this.zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchor);
    };
    this.scrollEl.addEventListener("wheel", onWheel, { passive: false });
    this.disposers.push(() => this.scrollEl.removeEventListener("wheel", onWheel));
  }

  private bindScroll(): void {
    const onScroll = (): void => {
      if (this.applyingScroll) return;
      const k = this.store.view.pxPerMm;
      if (!Number.isFinite(k) || k <= 0) return;
      const viewport = { width: this.scrollEl.clientWidth, height: this.scrollEl.clientHeight };
      const panCenter = panCenterFromScroll(
        k,
        { left: this.scrollEl.scrollLeft, top: this.scrollEl.scrollTop },
        viewport,
      );
      this.suppressScrollSync = true;
      this.store.setView(this.store.view.panTo(panCenter));
    };
    this.scrollEl.addEventListener("scroll", onScroll);
    this.disposers.push(() => this.scrollEl.removeEventListener("scroll", onScroll));
  }

  /**
   * 第7章7.9節: 未保存かどうかが変わるたびにmainへ知らせる。ウィンドウを閉じるときの確認は
   * mainの`CloseGuard`が行う（`beforeunload`は使わない。実機で確認なしに終了したため）。
   */
  private bindDirtyReport(): void {
    const gateway = this.windowGateway;
    if (!gateway) return;
    let reported = this.store.isDirty();
    gateway.setDirty(reported);
    this.disposers.push(
      this.store.subscribe(() => {
        const dirty = this.store.isDirty();
        if (dirty === reported) return;
        reported = dirty;
        gateway.setDirty(dirty);
      }),
    );
  }
}

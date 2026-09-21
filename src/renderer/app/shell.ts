// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— 最小 UI シェル。
//
// index.html が用意した DOM（ツールバー・スクロールコンテナ内の <svg>・ステータスバー）を
// 受け取り、モジュールE（`SvgRenderer`/`GestureController`）・F（`ViewState`）・
// D（`History` 経由の `AppStore.dispatch`）を配線する。ここが `SvgRenderer`/
// `GestureController`/`ViewState` を初めて実 DOM 上で動かす層である
// （[[TECSCDE-DT-EL実装]] 「次のステップ」）。
//
// スコープ: キャンバス・open/save/saveAs・Undo/Redo・ズーム・グリッド・ステータスバー・
// キーボード・Copy/Cut/Paste、およびモジュールG次段のパレット／プロパティパネル／
// 検索ボックス／ナビゲータパネル／診断パネル（2026-09-11・09-12、各パネルは専用クラスへ委譲する）。

import { GestureController } from "../render/gesture-controller";
import { SvgRenderer } from "../render/svg-renderer";
import type { Point } from "../model/geometry";
import type { TecscdeDocument } from "../model/document";
import { ZOOM_STEP } from "../view-state/view-state";
import type { FileGateway } from "../gateways/file-gateway";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import { AppGestureHost } from "./gesture-host";
import { baseName, openViaDialog, save, saveAs } from "./file-actions";
import { pasteFromClipboard } from "./clipboard-actions";
import { generate, tecsgenCommandLine } from "./tecsgen-actions";
import { panCenterFromScroll, scrollForPanCenter } from "./pan-scroll";
import { PaletteView } from "./palette";
import { PropertyPanelView } from "./property-panel";
import { SearchBoxView } from "./search-box";
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
  /** window 相当（キーボード・スクロール・beforeunload の結線先）。既定は globalThis の window。 */
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
  private readonly win: Window;

  private readonly svg: SVGSVGElement;
  private readonly scrollEl: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly statusPos: HTMLElement;
  private readonly statusZoom: HTMLElement;
  private readonly statusFile: HTMLElement;

  private readonly renderer: SvgRenderer;
  /** ドラッグ FSM。DOM 結線は `attach` 済み。テストはこの公開メソッドを直接叩ける。 */
  readonly gesture: GestureController;

  /** モジュールG次段（外部仕様3.3〜3.5節）。各パネルは自身のDOM配線・描画を持つ。 */
  private readonly palette: PaletteView;
  private readonly propertyPanel: PropertyPanelView;
  private readonly searchBox: SearchBoxView;
  private readonly navigator: NavigatorView;
  private readonly diagnosticsPanel: DiagnosticsPanelView;

  private readonly disposers: Array<() => void> = [];

  /** render() が発火させたスクロール書き込みを scroll ハンドラが無視するためのフラグ。 */
  private applyingScroll = false;
  /** scroll ハンドラ由来の setView で、続く render() のスクロール同期を1回だけ抑止する。 */
  private suppressScrollSync = false;

  constructor(opts: AppShellOptions) {
    this.store = opts.store;
    this.gateway = opts.gateway;
    this.clipboard = opts.clipboard;
    this.tecsgen = opts.tecsgen;
    this.win = opts.win ?? (globalThis as unknown as { window: Window }).window;

    const { root } = opts;
    this.svg = requireEl<SVGSVGElement>(root, "#canvas");
    this.scrollEl = requireEl<HTMLElement>(root, "#canvas-scroll");
    this.toolbar = requireEl<HTMLElement>(root, "#toolbar");
    this.zoomSlider = requireEl<HTMLInputElement>(root, "#zoom-slider");
    this.statusPos = requireEl<HTMLElement>(root, "#status-pos");
    this.statusZoom = requireEl<HTMLElement>(root, "#status-zoom");
    this.statusFile = requireEl<HTMLElement>(root, "#status-file");

    this.renderer = new SvgRenderer(this.svg);
    const host = new AppGestureHost(
      this.store,
      () => this.render(),
      (p) => this.updateStatusPos(p),
    );
    this.gesture = new GestureController(this.renderer, host);

    this.palette = new PaletteView(requireEl<HTMLElement>(root, "#palette"), this.store);
    this.propertyPanel = new PropertyPanelView(requireEl<HTMLElement>(root, "#property-panel"), this.store);
    this.searchBox = new SearchBoxView(requireEl<HTMLElement>(root, "#search-box"), this.store);
    this.navigator = new NavigatorView(requireEl<HTMLElement>(root, "#navigator"), this.store, this.scrollEl);
    this.diagnosticsPanel = new DiagnosticsPanelView(
      requireEl<HTMLButtonElement>(root, "#status-diag"),
      requireEl<HTMLElement>(root, "#diagnostics-panel"),
      this.store,
    );
  }

  /** 配線を張り、初回描画する。返り値でなく `dispose()` で解除する。 */
  start(): void {
    this.disposers.push(this.store.subscribe(() => this.render()));
    this.disposers.push(this.gesture.attach(this.svg));
    this.bindToolbar();
    this.bindZoomSlider();
    this.bindKeyboard();
    this.bindWheel();
    this.bindScroll();
    this.bindBeforeUnload();
    this.render();
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }

  // --- 描画ループ ---

  render(): void {
    const doc = this.store.getDocument();
    const view = this.store.view;
    const canvasView = view.toCanvasView(doc.regions);
    this.renderer.render(doc, canvasView, this.store.selection, {
      joinPreview: this.gesture.currentJoinPreview(),
    });
    this.syncScrollFromPan(doc);
    this.refreshToolbarState();
    this.refreshStatus();
    this.palette.render();
    this.propertyPanel.render();
    this.searchBox.render();
    this.navigator.render();
    this.diagnosticsPanel.render();
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
      case "open":
        void openViaDialog(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "save":
        void save(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
        break;
      case "saveAs":
        void saveAs(this.store, this.gateway).catch((err: unknown) => this.reportActionError(action, err));
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

  /** 外部仕様8.4.2: 実行に加えて、生成コマンドの提示・コピー経路も残す。 */
  private copyTecsgenCommand(): void {
    const commandLine = tecsgenCommandLine(this.store);
    if (commandLine) void this.clipboard.writeText(commandLine);
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

  private refreshToolbarState(): void {
    this.setDisabled("[data-action='undo']", !this.store.canUndo);
    this.setDisabled("[data-action='redo']", !this.store.canRedo);
    const canGenerate = this.store.filePath !== null && !this.store.isGenerating;
    this.setDisabled("[data-action='generate']", !canGenerate);
    this.setDisabled("[data-action='copyTecsgenCommand']", this.store.filePath === null);
    // 外部仕様3.2.1: スライダはボタン・ホイール・キーボードいずれのズーム変更にも追従する。
    this.zoomSlider.value = String(Math.round(this.store.view.zoom * 100));
  }

  private setDisabled(selector: string, disabled: boolean): void {
    const el = this.toolbar.querySelector<HTMLButtonElement>(selector);
    if (el) el.disabled = disabled;
  }

  // --- ステータスバー ---

  private refreshStatus(): void {
    this.statusZoom.textContent = `${Math.round(this.store.view.zoom * 100)}%`;
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
        case "o":
          e.preventDefault();
          void openViaDialog(this.store, this.gateway);
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

  private bindBeforeUnload(): void {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!this.store.isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    this.win.addEventListener("beforeunload", onBeforeUnload);
    this.disposers.push(() => this.win.removeEventListener("beforeunload", onBeforeUnload));
  }
}

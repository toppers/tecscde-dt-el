// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」— 最小 UI シェル。
//
// index.html が用意した DOM（ツールバー・スクロールコンテナ内の <svg>・ステータスバー）を
// 受け取り、モジュールE（`SvgRenderer`/`GestureController`）・F（`ViewState`）・
// D（`History` 経由の `AppStore.dispatch`）を配線する。ここが `SvgRenderer`/
// `GestureController`/`ViewState` を初めて実 DOM 上で動かす層である
// （[[TECSCDE-DT-EL実装]] 「次のステップ」）。
//
// スコープは最小シェル: キャンバス・open/save/saveAs・Undo/Redo・ズーム・グリッド・
// モード切替・ステータスバー・キーボード。パレット／プロパティパネル／検索ボックス／
// ナビゲータパネルは次段（2026-09-10 のユーザー確認）。

import { GestureController } from "../render/gesture-controller";
import { SvgRenderer } from "../render/svg-renderer";
import type { Point } from "../model/geometry";
import type { TecscdeDocument } from "../model/document";
import { ZOOM_STEP } from "../view-state/view-state";
import type { FileGateway } from "../gateways/file-gateway";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";
import { AppGestureHost } from "./gesture-host";
import { baseName, openViaDialog, save, saveAs } from "./file-actions";
import { pasteFromClipboard } from "./clipboard-actions";
import { panCenterFromScroll, scrollForPanCenter } from "./pan-scroll";
import type { AppStore } from "./store";

const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface AppShellOptions {
  /** 要素の探索起点（Electron では document、テストでは差し込んだ DOM）。 */
  readonly root: ParentNode;
  readonly store: AppStore;
  readonly gateway: FileGateway;
  /** 第4章4.1節: Copy/Cut/PasteのOSクリップボード連携。 */
  readonly clipboard: ClipboardGateway;
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
  private readonly win: Window;

  private readonly svg: SVGSVGElement;
  private readonly scrollEl: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly statusPos: HTMLElement;
  private readonly statusZoom: HTMLElement;
  private readonly statusDiag: HTMLElement;
  private readonly statusFile: HTMLElement;
  private readonly modeCheckbox: HTMLInputElement;
  private readonly celltypeSelect: HTMLSelectElement;

  private readonly renderer: SvgRenderer;
  /** ドラッグ FSM。DOM 結線は `attach` 済み。テストはこの公開メソッドを直接叩ける。 */
  readonly gesture: GestureController;

  private readonly disposers: Array<() => void> = [];

  /** render() が発火させたスクロール書き込みを scroll ハンドラが無視するためのフラグ。 */
  private applyingScroll = false;
  /** scroll ハンドラ由来の setView で、続く render() のスクロール同期を1回だけ抑止する。 */
  private suppressScrollSync = false;
  private celltypeSelectSig = "";

  constructor(opts: AppShellOptions) {
    this.store = opts.store;
    this.gateway = opts.gateway;
    this.clipboard = opts.clipboard;
    this.win = opts.win ?? (globalThis as unknown as { window: Window }).window;

    const { root } = opts;
    this.svg = requireEl<SVGSVGElement>(root, "#canvas");
    this.scrollEl = requireEl<HTMLElement>(root, "#canvas-scroll");
    this.toolbar = requireEl<HTMLElement>(root, "#toolbar");
    this.statusPos = requireEl<HTMLElement>(root, "#status-pos");
    this.statusZoom = requireEl<HTMLElement>(root, "#status-zoom");
    this.statusDiag = requireEl<HTMLElement>(root, "#status-diag");
    this.statusFile = requireEl<HTMLElement>(root, "#status-file");
    this.modeCheckbox = requireEl<HTMLInputElement>(root, "#mode-newcell");
    this.celltypeSelect = requireEl<HTMLSelectElement>(root, "#celltype-select");

    this.renderer = new SvgRenderer(this.svg);
    const host = new AppGestureHost(
      this.store,
      () => this.render(),
      (p) => this.updateStatusPos(p),
    );
    this.gesture = new GestureController(this.renderer, host);
  }

  /** 配線を張り、初回描画する。返り値でなく `dispose()` で解除する。 */
  start(): void {
    this.disposers.push(this.store.subscribe(() => this.render()));
    this.disposers.push(this.gesture.attach(this.svg));
    this.bindToolbar();
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
    this.refreshCelltypeSelect(doc);
    this.refreshToolbarState();
    this.refreshStatus();
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

    const onModeChange = (): void => {
      this.store.setMode(this.modeCheckbox.checked ? "newCell" : "select");
    };
    this.modeCheckbox.addEventListener("change", onModeChange);
    this.disposers.push(() => this.modeCheckbox.removeEventListener("change", onModeChange));

    const onCelltypeChange = (): void => {
      this.store.setActiveCelltype(this.celltypeSelect.value || undefined);
    };
    this.celltypeSelect.addEventListener("change", onCelltypeChange);
    this.disposers.push(() => this.celltypeSelect.removeEventListener("change", onCelltypeChange));
  }

  /** ツールバー／キーボード共通のコマンド入口。 */
  runAction(action: string): void {
    switch (action) {
      case "open":
        void openViaDialog(this.store, this.gateway);
        break;
      case "save":
        void save(this.store, this.gateway);
        break;
      case "saveAs":
        void saveAs(this.store, this.gateway);
        break;
      case "undo":
        this.store.undo();
        break;
      case "redo":
        this.store.redo();
        break;
      case "zoomIn":
        this.zoomBy(ZOOM_STEP);
        break;
      case "zoomOut":
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case "zoomReset":
        this.store.setView(this.store.view.resetZoom());
        break;
      case "toggleGrid":
        this.store.setView(this.store.view.toggleGrid());
        break;
      default:
        break;
    }
  }

  private zoomBy(factor: number, anchor?: Point): void {
    const a = anchor ?? this.store.view.panCenter;
    this.store.setView(this.store.view.zoomAt(a, factor));
  }

  private refreshCelltypeSelect(doc: TecscdeDocument): void {
    const names = doc.celltypeValues().map((c) => c.name);
    const sig = names.join(" ");
    if (sig === this.celltypeSelectSig) return;
    this.celltypeSelectSig = sig;
    this.celltypeSelect.replaceChildren();
    for (const name of names) {
      const opt = this.win.document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      this.celltypeSelect.appendChild(opt);
    }
    const active = this.store.getActiveCelltypeName();
    if (active && names.includes(active)) this.celltypeSelect.value = active;
    else this.store.setActiveCelltype(names[0]);
  }

  private refreshToolbarState(): void {
    this.setDisabled("[data-action='undo']", !this.store.canUndo);
    this.setDisabled("[data-action='redo']", !this.store.canRedo);
    const newCell = this.store.getMode() === "newCell";
    this.modeCheckbox.checked = newCell;
    this.celltypeSelect.disabled = !newCell;
  }

  private setDisabled(selector: string, disabled: boolean): void {
    const el = this.toolbar.querySelector<HTMLButtonElement>(selector);
    if (el) el.disabled = disabled;
  }

  // --- ステータスバー ---

  private refreshStatus(): void {
    this.statusZoom.textContent = `${Math.round(this.store.view.zoom * 100)}%`;
    const path = this.store.filePath;
    this.statusFile.textContent = path
      ? `${baseName(path)}${this.store.isDirty() ? " •" : ""}`
      : "(未保存)";
    // モジュールH: 診断の件数だけ表示する（一覧パネル・ジャンプ機構は G の次段、8.4節）。
    const report = this.store.getReport();
    this.statusDiag.textContent = report.isEmpty
      ? ""
      : `⚠ ${report.errorCount} エラー / ${report.warningCount} 警告`;
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

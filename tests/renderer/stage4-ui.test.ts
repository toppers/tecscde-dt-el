/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様]] 第6C章「V0.2.0表示と配置」— 段4 UI配線と機能の統合テスト。
// 監査44〜48、55、58。

import { afterEach, describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import type { TecscdeDocument } from "../../src/renderer/model/document";
import { Cell } from "../../src/renderer/model/cell";
import { asCellId, asJoinId, asRegionId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";
import { SelectionState } from "../../src/renderer/render/view";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { PropertyPanelView } from "../../src/renderer/app/property-panel";
import { SearchBoxView } from "../../src/renderer/app/search-box";
import { prepareMoveActiveToTop } from "../../src/renderer/commands/move-active-to-top";

const CDL_SAMPLE = `
signature sSig {
  void hello();
};

[active]
celltype tActive {
  call sSig cCall;
  entry sSig eEntry;
};

celltype tPassive {
  call sSig cCall;
  entry sSig eEntry;
};

cell tActive active1 {
};

cell tPassive passive1 {
};
`;

function buildTestDoc(cdl: string = CDL_SAMPLE): TecscdeDocument {
  return CdlDocumentLoader.loadSingle(cdl, "main.cdl").document;
}

const noopGateway = {
  save: async () => undefined,
  saveAs: async () => null,
  export: async () => undefined,
  chooseFolder: async () => null,
  listDirectory: async () => [],
  openPath: async () => ({ editable: { path: "x.cde", content: "" }, references: [] }),
  confirmDiscardChanges: async () => true,
  saveSession: async () => undefined,
  resolveImports: async () => [],
  onRestoreFileBrowserRoot: () => undefined,
} as unknown as FileGateway;

const fakeClipboard = {
  writeText: () => Promise.resolve(),
  readText: () => Promise.resolve(""),
} as unknown as ClipboardGateway;

const fakeTecsgen = {
  generate: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0, executableFound: true }),
  version: () => Promise.resolve(null),
} as unknown as TecsgenGateway;

const BODY_HTML = `
  <div id="app">
    <div id="toolbar">
      <button data-action="undo" type="button">元に戻す</button>
      <button data-action="redo" type="button">やり直し</button>
      <button data-action="alignTop" type="button">上端をそろえる</button>
      <button data-action="alignLeft" type="button">左端をそろえる</button>
      <button data-action="moveActiveToTop" type="button">アクティブを最上段へ</button>
      <button data-action="zoomReset" type="button">Reset Rate</button>
      <input id="zoom-slider" type="range" min="5" max="200" step="1" value="100" />
      <button data-action="toggleGrid" type="button">グリッド</button>
      <button data-action="toggleNavigator" type="button">ナビゲータ</button>
      <button data-action="generate" type="button">実行</button>
      <button data-action="copyTecsgenCommand" type="button">コマンドをコピー</button>
      <select id="tecsgen-copy-shell"><option value="powershell7">P7</option></select>
      <div id="display-controls">
        <div id="region-filter"><button id="region-filter-toggle" type="button"></button><div id="region-filter-popover" hidden></div></div>
        <button data-action="toggleRegionOutlineMode" id="toggle-region-outline" type="button" aria-pressed="false">リージョン矩形</button>
        <label><input type="checkbox" id="filter-color" /> 色分け</label>
        <label><input type="checkbox" id="filter-signature" /> シグニチャ名</label>
        <label><input type="checkbox" id="filter-emphasize" /> セル名強調</label>
        <label><input type="checkbox" id="filter-active-only" /> アクティブのみ</label>
        <button data-action="toggleConnectionFocus" id="toggle-connection-focus" type="button" aria-pressed="false">結合強調</button>
      </div>
      <div id="search-box">
        <input type="search" id="search-input" />
        <span id="search-count"></span>
        <button data-action="searchPrev" type="button">前</button>
        <button data-action="searchNext" type="button">次</button>
        <div id="search-results"></div>
      </div>
    </div>
    <div id="main">
      <div id="canvas-area">
        <div id="canvas-scroll"><svg id="canvas"></svg></div>
        <div id="region-legend" hidden></div>
        <div id="status-legend"></div>
        <div id="navigator"><svg viewBox="0 0 100 100"></svg></div>
      </div>
      <div id="property-panel"></div>
    </div>
    <div id="statusbar">
      <span id="status-mode"></span>
      <span id="status-pos"></span>
      <span id="status-zoom"></span>
      <span id="status-region"></span>
      <button id="status-diag" type="button"></button>
      <div id="diagnostics-panel" hidden></div>
      <span id="status-file"></span>
    </div>
    <div id="file-browser" hidden></div>
    <div id="palette" hidden>
      <div id="palette-mode">
        <button data-mode="select" type="button">選択</button>
        <button data-mode="newCell" type="button">セル新規作成</button>
      </div>
      <div id="palette-celltypes"></div>
    </div>
  </div>
`;

describe("Stage 4 UI Integration (監査44〜48, 55, 58)", () => {
  let shell: AppShell | undefined;

  afterEach(() => {
    shell?.dispose();
    shell = undefined;
    document.body.innerHTML = "";
  });

  function setup(doc: TecscdeDocument) {
    document.body.innerHTML = BODY_HTML;
    const store = new AppStore(doc);
    shell = new AppShell({
      root: document.body,
      store,
      gateway: noopGateway,
      clipboard: fakeClipboard,
      tecsgen: fakeTecsgen,
    });
    shell.start();
    return { store, shell, root: document.body };
  }

  it("アクティブを最上段へ: ボタン有効化と実行、移動完了ステータス (監査58, 6C.4)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    const btn = root.querySelector<HTMLButtonElement>("[data-action='moveActiveToTop']")!;
    expect(btn.disabled).toBe(false);

    btn.click();
    // active1 が最上段 (y=10) へ移動される
    const updatedCell = store.getDocument().cellValues().find((c) => c.name === "active1")!;
    expect(updatedCell.y).toBe(10);
    expect(updatedCell.x).toBe(10);

    const statusRegion = root.querySelector<HTMLElement>("#status-region")!;
    expect(statusRegion.textContent).toContain("アクティブセル 1 個を最上段へ配置しました");
  });

  it("アクティブセルがない場合は最上段ボタンが無効になる (監査58)", () => {
    const cdlNoActive = `
      celltype tPassive { entry sSig e; };
      cell tPassive passive1 {};
    `;
    const doc = buildTestDoc(cdlNoActive);
    const { root } = setup(doc);

    const btn = root.querySelector<HTMLButtonElement>("[data-action='moveActiveToTop']")!;
    expect(btn.disabled).toBe(true);
  });

  it("結合強調トグルと結合なしステータス表示 (監査46, 6C.3)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    const cfBtn = root.querySelector<HTMLButtonElement>("[data-action='toggleConnectionFocus']")!;
    expect(cfBtn.getAttribute("aria-pressed")).toBe("false");
    expect(store.isConnectionFocusEnabled()).toBe(false);

    cfBtn.click();
    expect(cfBtn.getAttribute("aria-pressed")).toBe("true");
    expect(store.isConnectionFocusEnabled()).toBe(true);

    // 未結合のポートを選択
    const activeCell = doc.cellValues().find((c) => c.name === "active1")!;
    const callPort = activeCell.cports[0]!;
    store.setSelection(
      SelectionState.ofPort({ cellId: activeCell.id, portName: callPort.name, portKind: "cport", subscript: null }),
    );

    const statusRegion = root.querySelector<HTMLElement>("#status-region")!;
    expect(statusRegion.textContent).toBe("結合なし");
  });

  it("リージョン矩形モードのトグル同期 (監査47, 6C.5)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    const roBtn = root.querySelector<HTMLButtonElement>("[data-action='toggleRegionOutlineMode']")!;
    expect(roBtn.getAttribute("aria-pressed")).toBe("false");
    expect(store.view.regionOutlineMode).toBe(false);

    roBtn.click();
    expect(roBtn.getAttribute("aria-pressed")).toBe("true");
    expect(store.view.regionOutlineMode).toBe(true);

    roBtn.click();
    expect(roBtn.getAttribute("aria-pressed")).toBe("false");
    expect(store.view.regionOutlineMode).toBe(false);
  });

  it("activeOnly チェックボックスの同期 (監査45, 6C.1)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    const aoCheckbox = root.querySelector<HTMLInputElement>("#filter-active-only")!;
    expect(aoCheckbox.checked).toBe(false);
    expect(store.view.filters.activeOnly).toBe(false);

    aoCheckbox.checked = true;
    aoCheckbox.dispatchEvent(new Event("change"));
    expect(store.view.filters.activeOnly).toBe(true);
  });

  it("検索ジャンプ時に非activeセルならactiveOnlyフィルタを自動緩和する (監査45, 6C.2)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    // activeOnly を true にする
    store.setView(store.view.withFilters(store.view.filters.withActiveOnly(true)));
    expect(store.view.filters.activeOnly).toBe(true);

    const searchInput = root.querySelector<HTMLInputElement>("#search-input")!;
    searchInput.value = "passive1";
    searchInput.dispatchEvent(new Event("input"));

    const searchNext = root.querySelector<HTMLButtonElement>("[data-action='searchNext']")!;
    searchNext.click();

    // passive1 (非active) へのジャンプで activeOnly が false に緩和される
    expect(store.view.filters.activeOnly).toBe(false);
  });

  it("プロパティパネルに CellVisualState (編集可否、不完全理由、未結合呼び口) を表示する (監査48, 5B)", () => {
    const doc = buildTestDoc();
    const { store, root } = setup(doc);

    const activeCell = doc.cellValues().find((c) => c.name === "active1")!;
    store.setSelection(SelectionState.ofCells([activeCell.id]));

    const panel = root.querySelector<HTMLElement>("#property-panel")!;
    expect(panel.textContent).toContain("編集可否: 編集可能");
    expect(panel.textContent).toContain("未結合の呼び口: cCall");
  });

  it("active最上段配置の溢れ時、W-ACTIVE-TOP-OVERFLOW が通知され Undo/Redo で同期する (監査58, 8.5)", () => {
    // 多数のアクティブセルを作成して用紙最上段に収まりきらない状況を作る
    let cdl = `signature sSig { void f(); }; [active] celltype tAct { call sSig c; };\n`;
    for (let i = 0; i < 20; i++) {
      cdl += `cell tAct act_${i} {};\n`;
    }
    let doc = buildTestDoc(cdl);
    // 初期配置を最上段以外 (y=100) にずらしておく
    for (const cell of doc.cellValues()) {
      doc = doc.withCell(cell.moveTo(cell.x, 100));
    }
    const { store, root } = setup(doc);

    const btn = root.querySelector<HTMLButtonElement>("[data-action='moveActiveToTop']")!;
    btn.click();

    // 診断レポートに W-ACTIVE-TOP-OVERFLOW が含まれているか
    const report = store.getReport();
    const overflowDiag = report.items.find((e) => e.code === W_CODES.ACTIVE_TOP_OVERFLOW);
    expect(overflowDiag).toBeDefined();
    expect(overflowDiag?.severity).toBe("warning");

    // Undo すると警告が解除される
    store.undo();
    const reportAfterUndo = store.getReport();
    expect(reportAfterUndo.items.find((e) => e.code === W_CODES.ACTIVE_TOP_OVERFLOW)).toBeUndefined();

    // Redo すると警告が再構成される
    store.redo();
    const reportAfterRedo = store.getReport();
    expect(reportAfterRedo.items.find((e) => e.code === W_CODES.ACTIVE_TOP_OVERFLOW)).toBeDefined();
  });

  it("用紙内に置けない場合、W-ACTIVE-TOP-FAILED が通知され dispatch されない (監査58, 8.5)", () => {
    const cdl = `
      signature sSig { void f(); };
      [active] celltype tAct { call sSig c; };
      cell tAct act1 {};
    `;
    let doc = buildTestDoc(cdl);
    // 用紙全体 (0, 0, 300, 300) を覆う読み取り専用セルを障害物として追加
    const bigObstacle = Cell.create({
      id: asCellId("c_obs"),
      name: "obs",
      celltypeName: "tAct",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      regionId: ROOT_REGION_ID,
      editable: false,
      cports: [],
      eports: [],
      attrs: {},
      celltypeUnresolved: false,
    });
    doc = doc.withCell(bigObstacle);

    const { store, root } = setup(doc);
    const initialRevision = store.documentRevision;

    const btn = root.querySelector<HTMLButtonElement>("[data-action='moveActiveToTop']")!;
    btn.click();

    // 診断レポートに W-ACTIVE-TOP-FAILED が含まれているか
    const report = store.getReport();
    const failedDiag = report.items.find((e) => e.code === W_CODES.ACTIVE_TOP_FAILED);
    expect(failedDiag).toBeDefined();
    expect(failedDiag?.severity).toBe("warning");

    // dispatch されず revision も変わらない
    expect(store.documentRevision).toBe(initialRevision);
  });
});

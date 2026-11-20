// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Cell } from "../../src/renderer/model/cell";
import { CelltypeRef } from "../../src/renderer/model/celltype";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { PaperSpec } from "../../src/renderer/model/paper";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";
import { CellRenderer } from "../../src/renderer/render/cell-renderer";
import { defaultCanvasView } from "../../src/renderer/render/view";
import { DisplayFilters } from "../../src/renderer/view-state/display-filters";
import { ViewState } from "../../src/renderer/view-state/view-state";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { SettingsGateway } from "../../src/renderer/gateways/settings-gateway";
import type { ToolSettings, ToolSettingsUpdate } from "../../src/shared/ipc-types";

function makeDoc(): TecscdeDocument {
  const ct = CelltypeRef.create({
    name: "nMruby::tBridge",
    cportTemplates: [],
    eportTemplates: [],
    attributeNames: [],
    hiddenRequirePortCount: 0,
  });
  const cell = Cell.create({
    id: asCellId("MyLongCell"),
    name: "MyLongCell",
    celltypeName: "nMruby::tBridge",
    x: 20,
    y: 20,
    width: 30,
    height: 20,
    regionId: ROOT_REGION_ID,
    editable: false, // triggers RO badge
    cports: [],
    eports: [],
    attrs: {},
    celltypeUnresolved: false,
  });
  return TecscdeDocument.build({
    cells: new Map([[cell.id, cell]]),
    joins: new Map(),
    celltypes: new Map([[ct.name, ct]]),
    toolInfoTecsgen: emptyToolInfoTecsgen(),
    paper: PaperSpec.default(),
    referenceFiles: [],
    unknownToolInfoTecscde: {},
  });
}

describe("V0.3.1 Stage 2: display toggles rendering and toolbar persistence", () => {
  it("CellRenderer applies showCelltypeName, cellNameDisplay, showStatusSymbols, namespaceDisplay, and emphasizeCellName coexistence", () => {
    const doc = makeDoc();
    const cell = doc.cellValues()[0]!;
    const renderer = new CellRenderer();

    // Default: full cell name, full celltype name, status badge RO visible
    const gDefault = renderer.createElement(cell, { view: defaultCanvasView(), doc });
    expect(gDefault.querySelector(".cell-label")?.textContent).toBe("MyLongCell");
    expect(gDefault.querySelector(".celltype-label")?.textContent).toBe("nMruby::tBridge");
    expect(gDefault.querySelector(".cell-status-badges")).not.toBeNull();

    // Shorten cell name + dot namespace + hide status symbols
    const viewShort = ViewState.initial()
      .withFilters(
        DisplayFilters.allVisible()
          .withCellNameDisplay("shorten")
          .withNamespaceDisplay("dot")
          .withShowStatusSymbols(false),
      )
      .toCanvasView(doc.regions);
    const gShort = renderer.createElement(cell, { view: viewShort, doc });
    expect(gShort.querySelector(".cell-label")?.textContent).toBe("My--ll");
    expect(gShort.querySelector(".celltype-label")?.textContent).toBe("●::tBridge");
    expect(gShort.querySelector(".cell-status-badges")).toBeNull();

    // Hide celltype name
    const viewNoType = ViewState.initial()
      .withFilters(DisplayFilters.allVisible().withShowCelltypeName(false))
      .toCanvasView(doc.regions);
    const gNoType = renderer.createElement(cell, { view: viewNoType, doc });
    expect(gNoType.querySelector(".cell-label")?.textContent).toBe("MyLongCell");
    expect(gNoType.querySelector(".celltype-label")).toBeNull();

    // Hide cell name even when emphasizeCellName is true -> cell label hidden, celltype still visible
    const viewHideCell = ViewState.initial()
      .withFilters(DisplayFilters.allVisible().withCellNameDisplay("hide").withEmphasizeCellName(true))
      .toCanvasView(doc.regions);
    const gHideCell = renderer.createElement(cell, { view: viewHideCell, doc });
    expect(gHideCell.querySelector(".cell-label")).toBeNull();
    expect(gHideCell.querySelector(".celltype-label")?.textContent).toBe("nMruby::tBridge");
  });

  it("AppShell restores display toggles from settings, disables emphasize when cell name is hidden, and persists changes", async () => {
    const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf-8");
    const bodyMatch = /<body>([\s\S]*)<script/.exec(html);
    document.body.innerHTML = bodyMatch![1]!;

    const doc = makeDoc();
    const store = new AppStore(doc);

    const savedPatches: ToolSettingsUpdate[] = [];
    const baseToolSettings: ToolSettings = {
      revision: 1,
      tecsgenPath: "",
      tecspath: "",
      tecsgenCommandEnv: "",
      effectiveSource: "missing",
      effectiveCommand: "",
      executable: "",
      prefixArgs: [],
      override: false,
      cppPath: "",
      effectiveCppCommand: "gcc",
      effectiveCppFullPath: "",
      cppOrigin: "default",
      pluginTypeSource: "external",
      cdlFilesRoot: "",
      showCelltypeName: false,
      cellNameDisplay: "shorten",
      showStatusSymbols: false,
      namespaceDisplay: "dot",
    };

    const settings = {
      get: vi.fn(async () => ({ allowEditSystemDefined: false })),
      getToolSettings: vi.fn(async () => baseToolSettings),
      updateToolSettings: vi.fn(async (patch: ToolSettingsUpdate) => {
        savedPatches.push(patch);
        return { ok: true as const, settings: { ...baseToolSettings, ...patch } };
      }),
      chooseTecsgenPath: vi.fn(async () => null),
      chooseCppPath: vi.fn(async () => null),
      getAppInformation: vi.fn(async () => ({
        name: "tecscde-dt-el",
        version: "0.3.0",
        commit: "abc1234",
        cdeFormatVersion: "0.1.0.0",
        electron: "44",
        chrome: "130",
        node: "22",
        platform: "win32",
        arch: "x64",
      })),
      chooseCdlFilesRoot: vi.fn(async () => null),
    } as unknown as SettingsGateway;

    const gateway = {
      onRestoreFileBrowserRoot: vi.fn(),
      readDefinitionFile: vi.fn(),
    } as unknown as FileGateway;
    const clipboard = { writeText: vi.fn(), readText: vi.fn() } as unknown as ClipboardGateway;
    const tecsgen = {} as unknown as TecsgenGateway;

    const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, settings, win: window });
    shell.start();
    // Wait for async getToolSettings restoration
    await new Promise((r) => setTimeout(r, 0));

    // Restored state
    expect(store.view.filters.showCelltypeName).toBe(false);
    expect(store.view.filters.cellNameDisplay).toBe("shorten");
    expect(store.view.filters.showStatusSymbols).toBe(false);
    expect(store.view.filters.namespaceDisplay).toBe("dot");
    expect(document.querySelector<HTMLElement>("#status-legend")!.hidden).toBe(true);

    const emphasize = document.querySelector<HTMLInputElement>("#filter-emphasize")!;
    expect(emphasize.disabled).toBe(false);

    // Switch cellNameDisplay to "hide" -> emphasize becomes disabled and setting is persisted
    const cellNameSelect = document.querySelector<HTMLSelectElement>("#filter-cell-name")!;
    cellNameSelect.value = "hide";
    cellNameSelect.dispatchEvent(new Event("change"));
    expect(store.view.filters.cellNameDisplay).toBe("hide");
    expect(emphasize.disabled).toBe(true);
    expect(savedPatches).toContainEqual({ cellNameDisplay: "hide" });

    // Toggle status symbols back on -> #status-legend becomes visible and setting is persisted
    const symbolsCheckbox = document.querySelector<HTMLInputElement>("#filter-status-symbols")!;
    symbolsCheckbox.checked = true;
    symbolsCheckbox.dispatchEvent(new Event("change"));
    expect(store.view.filters.showStatusSymbols).toBe(true);
    expect(document.querySelector<HTMLElement>("#status-legend")!.hidden).toBe(false);
    expect(savedPatches).toContainEqual({ showStatusSymbols: true });

    shell.dispose();
  });
});

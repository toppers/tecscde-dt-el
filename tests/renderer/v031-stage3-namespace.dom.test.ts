// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { AppStore } from "../../src/renderer/app/store";
import { AppShell } from "../../src/renderer/app/shell";
import { NamespaceLegendView } from "../../src/renderer/app/namespace-legend";
import { NamespaceDetailsView } from "../../src/renderer/app/namespace-details-view";
import { DefinitionFileView } from "../../src/renderer/app/definition-file-view";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { ClipboardGateway } from "../../src/renderer/gateways/clipboard-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { SettingsGateway } from "../../src/renderer/gateways/settings-gateway";

describe("V0.3.1 Stage 3: namespace legend, details dialog, and DefinitionFileView integration", () => {
  it("collects namespace files including Windows paths with case-insensitive deduplication", () => {
    const fileA = "C:\\Work\\Proj\\alpha.cdl";
    const fileADup = "c:\\work\\proj\\alpha.cdl";
    const fileB = "C:\\Work\\Proj\\beta.cdl";
    const cdlA = `
signature sX { void run(void); };
namespace nBeta {
  celltype tBeta { entry sX e; };
};
namespace nAlpha {
  celltype tAlpha { entry sX e; };
};
`;
    const cdlB = `
namespace nAlpha {
  cell tAlpha a1 {};
};
cell nBeta::tBeta b1 {};
`;

    const { document: doc } = CdlDocumentLoader.loadSources([
      { fileName: "alpha.cdl", sourcePath: fileA, text: cdlA, editable: false },
      { fileName: "alpha.cdl", sourcePath: fileADup, text: "namespace nAlpha { };", editable: false },
      { fileName: "beta.cdl", sourcePath: fileB, text: cdlB, editable: true },
    ]);

    expect([...doc.namespaceFiles.keys()].sort()).toEqual(["nAlpha", "nBeta"]);
    expect(doc.namespaceFiles.get("nAlpha")).toEqual([
      { path: fileA, generated: false },
      { path: fileB, generated: false },
    ]);
    expect(doc.namespaceFiles.get("nBeta")).toEqual([
      { path: fileA, generated: false },
      { path: fileB, generated: false },
    ]);
  });

  it("renders NamespaceLegendView sorted ascending, opens NamespaceDetailsView, and opens DefinitionFileView with Windows path", async () => {
    const winPath = "C:\\Users\\dev\\tecs\\nAlpha.cdl";
    const cdl = `
signature sX { void run(void); };
namespace nAlpha {
  celltype tAlpha { entry sX e; };
  cell tAlpha c1 {};
};
`;
    const { document: doc } = CdlDocumentLoader.loadSources([
      { fileName: "nAlpha.cdl", sourcePath: winPath, text: cdl, editable: true },
    ]);
    const store = new AppStore(doc);

    const readFile = vi.fn(async (path: string) => ({ path, content: cdl }));
    const defView = new DefinitionFileView({ document, readFile });
    const detailsView = new NamespaceDetailsView({
      document,
      store,
      onShowFile: (source) => void defView.open(source, "ファイル"),
    });
    const legendRoot = document.createElement("div");
    const legend = new NamespaceLegendView(legendRoot, store, (ns) => detailsView.open(ns));
    legend.render();

    expect(legendRoot.hidden).toBe(false);
    const usedBtn = legendRoot.querySelector<HTMLButtonElement>("[data-namespace-files='nAlpha']");
    expect(usedBtn).not.toBeNull();
    expect(usedBtn!.textContent).toBe("使用されたファイル");

    usedBtn!.click();
    expect(detailsView.isOpen).toBe(true);

    const pathEl = document.querySelector<HTMLElement>(".namespace-details-path");
    expect(pathEl?.textContent).toBe(winPath);

    const refBtn = document.querySelector<HTMLButtonElement>("[data-open-namespace-file]");
    expect(refBtn).not.toBeNull();
    expect(refBtn!.textContent).toBe("参照");
    expect(refBtn!.disabled).toBe(false);

    refBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(readFile).toHaveBeenCalledWith(winPath);
    expect(defView.isOpen).toBe(true);
    expect(document.querySelector(".definition-file-window pre")?.textContent).toBe(cdl);

    detailsView.dispose();
    defView.dispose();
  });

  it("opens virtual generated sources in DefinitionFileView without calling disk readFile", async () => {
    const virtualPath = "plugin:MrubyBridgePlugin/tBridge.cdl";
    const virtualContent = "signature sX { void run(void); };\nnamespace nMruby { celltype tBridge { entry sX e; }; };";
    const { document: doc } = CdlDocumentLoader.loadSources([
      { fileName: virtualPath, sourcePath: virtualPath, text: virtualContent, editable: false, generated: true },
    ]);
    const store = new AppStore(doc);
    store.setGeneratedTypeSources([{ fileName: virtualPath, content: virtualContent }]);

    const readFile = vi.fn(async (path: string) => ({ path, content: "" }));
    const defView = new DefinitionFileView({ document, readFile });
    const detailsView = new NamespaceDetailsView({
      document,
      store,
      onShowFile: (source) => void defView.open(source, "ファイル"),
    });

    detailsView.open("nMruby");
    const refBtn = document.querySelector<HTMLButtonElement>("[data-open-namespace-file]")!;
    expect(refBtn.disabled).toBe(false);
    refBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(readFile).not.toHaveBeenCalled();
    expect(defView.isOpen).toBe(true);
    expect(document.querySelector(".definition-file-window pre")?.textContent).toBe(virtualContent);

    detailsView.dispose();
    defView.dispose();
  });

  it("wires #namespace-legend -> NamespaceDetailsView -> DefinitionFileView end-to-end in AppShell", async () => {
    const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf-8");
    const bodyMatch = /<body>([\s\S]*)<script/.exec(html);
    document.body.innerHTML = bodyMatch![1]!;

    const winPath = "C:\\proj\\ev3\\sample.cdl";
    const cdl = `
signature sRun { void run(void); };
namespace nSample {
  celltype tTask { entry sRun e; };
  cell tTask task1 {};
};
`;
    const { document: doc } = CdlDocumentLoader.loadSources([
      { fileName: "sample.cdl", sourcePath: winPath, text: cdl, editable: true },
    ]);
    const store = new AppStore(doc);
    const readDefinitionFile = vi.fn(async (path: string) => ({ path, content: cdl }));
    const gateway = {
      onRestoreFileBrowserRoot: vi.fn(),
      readDefinitionFile,
    } as unknown as FileGateway;
    const clipboard = { writeText: vi.fn(), readText: vi.fn() } as unknown as ClipboardGateway;
    const tecsgen = {} as unknown as TecsgenGateway;
    const settings = {
      get: vi.fn(async () => ({ allowEditSystemDefined: false })),
      getToolSettings: vi.fn(async () => ({})),
      updateToolSettings: vi.fn(async () => ({ ok: true, settings: {} })),
    } as unknown as SettingsGateway;

    const shell = new AppShell({ root: document, store, gateway, clipboard, tecsgen, settings, win: window });
    shell.start();

    const legendEl = document.querySelector<HTMLElement>("#namespace-legend")!;
    expect(legendEl.hidden).toBe(false);
    const openBtn = legendEl.querySelector<HTMLButtonElement>("[data-namespace-files='nSample']")!;
    openBtn.click();

    const refBtn = document.querySelector<HTMLButtonElement>(".namespace-details-dialog [data-open-namespace-file]")!;
    refBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(readDefinitionFile).toHaveBeenCalledWith(winPath);
    expect(document.querySelector(".definition-file-window")?.hasAttribute("open")).toBe(true);

    shell.dispose();
  });
});

/** @vitest-environment happy-dom */
// 三者相違一覧 4-1・2-10・4-3・5-14・5-3・5-21・9-5（V0.2.6 段4）: 失敗と拒否を、診断一覧へ出す。
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { applyOpenResult, loadOptionsFile, save } from "../../src/renderer/app/file-actions";
import { SaveFailure, actionFailureDiagnostic } from "../../src/renderer/app/action-failure";
import { EditAttrCommand } from "../../src/renderer/commands/cell-commands";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
const main = "signature sMain { void run(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const reference = "celltype tRef { attr { int count; }; };\ncell tRef Ref { count = 1; };\n";
const tool = {} as TecsgenGateway;
const codes = (store: AppStore): string[] => store.getReport().items.map((item) => item.code);

let shell: AppShell | undefined;
afterEach(() => { shell?.dispose(); shell = undefined; document.head.replaceChildren(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mountShell(saveImpl: () => Promise<unknown>) {
  document.head.innerHTML = html.split("<head>")[1]!.split("</head>")[0]!;
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(CdlDocumentLoader.loadSingle("signature sMain { void f(void); };\ncelltype tMain { entry sMain e; };\ncell tMain Main {};\n", "main.cdl").document);
  store.loadDocument(store.getDocument(), "/proj/main.cdl", [], [], new Map(), [], undefined);
  const gateway = { onRestoreFileBrowserRoot: vi.fn(), save: vi.fn(saveImpl), saveSession: vi.fn(async () => {}) } as unknown as FileGateway;
  shell = new AppShell({ root: document, store, win: window, gateway, tecsgen: {} as never, clipboard: {} as never });
  shell.start();
  return { store, gateway };
}

describe("失敗を診断一覧へ出す（4-1・2-10）", () => {
  it("shows a failed save from the toolbar as E-SAVE-FAILED with the reason", async () => {
    const { store } = mountShell(async () => { throw new Error("disk full"); });
    document.querySelector<HTMLButtonElement>("[data-action=save]")!.click();
    await new Promise((done) => setTimeout(done, 0));
    const item = store.getReport().items.find((entry) => entry.code === "E-SAVE-FAILED");
    expect(item?.severity).toBe("error");
    expect(item?.message).toContain("disk full");
  });

  it("shows a failed Ctrl+S the same way instead of dropping the rejection", async () => {
    const { store } = mountShell(async () => { throw new Error("read only volume"); });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((done) => setTimeout(done, 0));
    expect(store.getReport().items.find((entry) => entry.code === "E-SAVE-FAILED")?.message).toContain("read only volume");
  });
});

describe("actionFailureDiagnostic（5-14・5-21）", () => {
  it("maps open actions to E-OPEN-FAILED, save actions to E-SAVE-FAILED and others to E-ACTION-FAILED", () => {
    expect(actionFailureDiagnostic("openFolder", new Error("not found"))).toMatchObject({ severity: "error", code: "E-OPEN-FAILED" });
    expect(actionFailureDiagnostic("addAsReference", new Error("x")).code).toBe("E-OPEN-FAILED");
    expect(actionFailureDiagnostic("loadOptionsFile", new Error("x")).code).toBe("E-OPEN-FAILED");
    expect(actionFailureDiagnostic("save", new Error("x")).code).toBe("E-SAVE-FAILED");
    expect(actionFailureDiagnostic("saveAs", new Error("x")).code).toBe("E-SAVE-FAILED");
    expect(actionFailureDiagnostic("about", new Error("x")).code).toBe("E-ACTION-FAILED");
    expect(actionFailureDiagnostic("openFolder", "plain string").message).toContain("plain string");
  });

  it("names the startup load failure as such, not as a parser initialization failure", () => {
    const diagnostic = actionFailureDiagnostic("bootstrap", new Error("cannot resolve"));
    expect(diagnostic.code).toBe("E-OPEN-FAILED");
    expect(diagnostic.message).toContain("起動時");
    expect(diagnostic.message).not.toContain("パーサの初期化");
    expect(diagnostic.message).toContain("cannot resolve");
  });

  it("lists the failed and the saved sources of a partial save", () => {
    const diagnostic = actionFailureDiagnostic("save", new SaveFailure([{ path: "/ref.cdl", reason: "disk full" }], ["/main.cdl"]));
    expect(diagnostic.message).toContain("/ref.cdl");
    expect(diagnostic.message).toContain("disk full");
    expect(diagnostic.message).toContain("/main.cdl");
    expect(diagnostic.message).toContain("保存できたファイル");
  });
});

function setupSaveStore(systemDirs: readonly string[] = []) {
  const gateway = {
    resolveImports: vi.fn(async () => []),
    save: vi.fn(async (_path: string, _content: string) => undefined as unknown),
    saveAs: vi.fn(async () => null), saveSession: vi.fn(async () => {}), confirmDiscardChanges: vi.fn(async () => true),
  };
  const file = gateway as unknown as FileGateway;
  const store = new AppStore();
  return { store, gateway, file, load: () => applyOpenResult(store, file, tool, {
    editable: { path: systemDirs.length > 0 ? "/sys/main.cdl" : "/main.cdl", content: main },
    references: [{ path: "/ref.cdl", content: reference }],
    ...(systemDirs.length > 0 ? { systemDirs } : {}),
  }) };
}

describe("一部失敗の保存（4-1）", () => {
  it("throws a SaveFailure that separates the failed sources from the saved ones", async () => {
    const { store, gateway, load, file } = setupSaveStore(); await load();
    store.dispatch(new EditAttrCommand(asCellId("Ref"), "count", "9"));
    gateway.save.mockImplementation(async (path: string) => { if (path === "/ref.cdl") throw new Error("disk full"); return undefined; });
    const error = await save(store, file).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(SaveFailure);
    expect((error as SaveFailure).failed).toEqual([{ path: "/ref.cdl", reason: "disk full" }]);
    expect((error as SaveFailure).saved).toEqual(["/main.cdl"]);
  });
});

describe("閲覧のみの主ファイルでの保存（4-3）", () => {
  it("saves the edited reference, skips the read-only primary and tells the user", async () => {
    const { store, gateway, load, file } = setupSaveStore(["/sys"]); await load();
    expect(store.isEditingFileReadOnlySystemDefined()).toBe(true);
    store.dispatch(new EditAttrCommand(asCellId("Ref"), "count", "9"));
    await save(store, file);
    expect(gateway.save.mock.calls.map(([path]) => path)).toEqual(["/ref.cdl"]);
    expect(codes(store)).toContain("W-SAVE-READONLY");
  });

  it("only tells the user when there is nothing to save", async () => {
    const { store, gateway, load, file } = setupSaveStore(["/sys"]); await load();
    await save(store, file);
    expect(gateway.save).not.toHaveBeenCalled();
    expect(codes(store)).toContain("W-SAVE-READONLY");
  });
});

describe("opts に CDL が 0 件（5-3）", () => {
  it("keeps the diagram and tells the user", async () => {
    const store = new AppStore();
    const gateway = { parseTecsgenOptionsFile: vi.fn(async () => ({ cdlFiles: [], importPaths: [], defineMacros: [], systemDirs: [] })) } as unknown as FileGateway;
    await loadOptionsFile(store, gateway, tool, "/proj/empty.tecsgen-opts");
    expect(codes(store)).toContain("W-OPTS-NO-CDL");
  });
});

describe("W-UNRESOLVED-CELLTYPE の二重計上（9-5）", () => {
  it("reports an unresolved celltype once even though loading and the integrity check both find it", async () => {
    const store = new AppStore();
    const file = { resolveImports: vi.fn(async () => []), saveSession: vi.fn(async () => {}) } as unknown as FileGateway;
    await applyOpenResult(store, file, tool, { editable: { path: "/main.cdl", content: "cell tUndefinedType cFoo {}\n" }, references: [] });
    expect(codes(store).filter((code) => code === "W-UNRESOLVED-CELLTYPE")).toHaveLength(1);
  });
});

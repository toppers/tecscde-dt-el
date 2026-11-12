import { describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { addAsReference, applyOpenResult, newDocument, save, saveAs } from "../../src/renderer/app/file-actions";
import { AddCellCommand, EditAttrCommand, MoveCellsCommand } from "../../src/renderer/commands/cell-commands";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { ImportRequest, ImportResolutionOptions, ResolvedImport } from "../../src/shared/ipc-types";

const main = "signature sMain { void run(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const reference = "// reference body\r\ncelltype tRef { attr { int count; }; };\r\ncell tRef Ref { count = 1; };\r\n";
const tool = {} as TecsgenGateway;
function setup() {
  const gateway = {
    resolveImports: vi.fn(async (_source: string, _requests: readonly ImportRequest[], _options: ImportResolutionOptions): Promise<ResolvedImport[]> => []),
    save: vi.fn(async (_path: string, _content: string) => {}),
    saveAs: vi.fn(async (_content: string, _name: string) => "/new.cdl"),
    saveSession: vi.fn(async () => {}), confirmDiscardChanges: vi.fn(async () => true),
  };
  return { store: new AppStore(), gateway, file: gateway as unknown as FileGateway };
}
async function load(store: AppStore, file: FileGateway) {
  await applyOpenResult(store, file, tool, { editable: { path: "/main.cdl", content: main },
    references: [{ path: "/ref.cdl", content: reference }] });
}

describe("stage1 source actions", () => {
  it("clears the primary while retaining reference bodies, unsaved model edits and saved baselines", async () => {
    const { store, gateway, file } = setup(); await load(store, file);
    store.dispatch(new EditAttrCommand(asCellId("Ref"), "count", "42"));
    const body = CdlSerializer.serializeSource(store.getDocument(), "/ref.cdl");
    const template = store.getDocument().sourceTemplates.get("/ref.cdl")!;
    expect(body).toContain("count = 42;");
    await newDocument(store, file);
    expect(store.getDocument().getCell(asCellId("Main"))).toBeUndefined();
    expect(store.getDocument().getCell(asCellId("Ref"))?.attrs.count).toBe("42");
    expect(store.getDocument().sourceTemplates.get("/ref.cdl")).toBe(template);
    expect(template.text).toBe(reference);
    expect(CdlSerializer.serializeSource(store.getDocument(), "/ref.cdl")).toBe(body);
    expect(store.isSourceDirty("/ref.cdl")).toBe(true);
    expect(store.isSourceDirty(null)).toBe(false);
    expect(store.isDirty()).toBe(true);
    expect(store.getSessionSnapshot().sourceOrder).toEqual(["/ref.cdl"]);
    await saveAs(store, file); await save(store, file);
    expect(gateway.save.mock.calls.find(([path]) => path === "/ref.cdl")?.[1]).toBe(body);
    expect(store.isDirty()).toBe(false);
  });

  it("keeps cancellation unchanged and clears a document without references to a clean empty primary", async () => {
    const { store, gateway, file } = setup(); await load(store, file);
    store.dispatch(new MoveCellsCommand([asCellId("Main")], 5, 0));
    const before = store.getDocument(); gateway.confirmDiscardChanges.mockResolvedValueOnce(false);
    await newDocument(store, file);
    expect(store.getDocument()).toEqual(before); expect(store.isDirty()).toBe(true);
    await applyOpenResult(store, file, tool, { editable: { path: "/main.cdl", content: main }, references: [] });
    await newDocument(store, file);
    expect(store.getDocument().cellCount).toBe(0); expect(store.isDirty()).toBe(false);
    expect(store.getSessionSnapshot()).toMatchObject({ editablePath: null, referencePaths: [], sourceOrder: [] });
  });

  it("adds recursive references to an unsaved primary without changing its identity or checkpoint", async () => {
    const { store, gateway, file } = setup(); await load(store, file); await newDocument(store, file);
    store.dispatch(new MoveCellsCommand([asCellId("Ref")], 5, 0));
    const body = CdlSerializer.serializeSource(store.getDocument(), "/ref.cdl");
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
      canonicalPath: request.specifier === "nested.cdl" ? "/added/nested.cdl" : request.specifier,
      content: request.specifier === "/added/extra.cdl" ? 'import("nested.cdl"); celltype tExtra {};' : "celltype tNested {};",
    })));
    await addAsReference(store, file, tool, "/added/extra.cdl");
    expect(store.filePath).toBeNull(); expect(store.getDocument().primarySourceKey).toBeNull();
    expect(store.getReferenceFilePaths()).toEqual(["/ref.cdl", "/added/extra.cdl", "/added/nested.cdl"]);
    expect(gateway.resolveImports.mock.calls.some(([source, requests]) => source === "/added/extra.cdl" &&
      requests.some((request) => request.specifier === "nested.cdl"))).toBe(true);
    expect(CdlSerializer.serializeSource(store.getDocument(), "/ref.cdl")).toBe(body);
    expect(store.isSourceDirty("/ref.cdl")).toBe(true);
    expect(store.isSourceDirty(null)).toBe(false);
    expect(store.isSourceDirty("/added/extra.cdl")).toBe(false);
  });

  it("preserves unsaved anonymous-primary cells while adding and treats duplicate aliases as a no-op", async () => {
    const { store, gateway, file } = setup(); await load(store, file); await newDocument(store, file);
    store.dispatch(new AddCellCommand("tRef", 20, 30));
    const cell = store.getDocument().getCell(asCellId("Ref1"))!;
    expect(cell.locale).toBeUndefined(); expect(store.isSourceDirty(null)).toBe(true);
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
      canonicalPath: "/added/extra.cdl", content: "celltype tExtra {};",
    })));
    await addAsReference(store, file, tool, "/added/extra.cdl");
    expect(store.getDocument().getCell(cell.id)).toEqual(cell);
    expect(store.isSourceDirty(null)).toBe(true); expect(store.filePath).toBeNull();
    expect(store.getSessionSnapshot().sourceOrder).toEqual(["/ref.cdl", "/added/extra.cdl"]);
    const session = store.getSessionSnapshot(); const document = store.getDocument();
    gateway.saveSession.mockClear();
    await addAsReference(store, file, tool, "/added/./extra.cdl");
    expect(store.getDocument()).toEqual(document); expect(store.getSessionSnapshot()).toEqual(session);
    expect(gateway.saveSession).not.toHaveBeenCalled();
  });

  it("adds to a new empty diagram and to a determined dirty primary without changing their checkpoints", async () => {
    for (const determined of [false, true]) {
      const { store, gateway, file } = setup();
      if (determined) {
        await load(store, file); store.dispatch(new MoveCellsCommand([asCellId("Main")], 5, 0));
      }
      const primary = store.getDocument().cellValues().find((cell) => cell.name === "Main");
      gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
        canonicalPath: "/added/extra.cdl", content: "celltype tExtra {};",
      })));
      await addAsReference(store, file, tool, "/added/extra.cdl");
      expect(store.filePath).toBe(determined ? "/main.cdl" : null);
      expect(store.getDocument().getCell(asCellId("Main"))).toEqual(primary);
      expect(store.isDirty()).toBe(determined);
      expect(store.getReferenceFilePaths()).toContain("/added/extra.cdl");
    }
  });

  it("leaves the diagram and session unchanged when recursive addition cannot resolve an import", async () => {
    const { store, gateway, file } = setup();
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) =>
      request.kind === "manual" ? { request, canonicalPath: "/added/extra.cdl", content: 'import("missing.cdl");' }
        : { request, error: "not-found" }));
    const before = store.getDocument(); const session = store.getSessionSnapshot();
    await addAsReference(store, file, tool, "/added/extra.cdl");
    expect(store.getDocument()).toEqual(before); expect(store.getSessionSnapshot()).toEqual(session);
    expect(gateway.saveSession).not.toHaveBeenCalled();
  });

  it("uses the added file's own tool_info and parent to resolve its imports without a primary", async () => {
    const { store, gateway, file } = setup();
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
      canonicalPath: request.kind === "manual" ? "/added/extra.cdl" : "/added/includes/nested.cdl",
      content: request.kind === "manual" ? '__tool_info__("tecsgen") { "import_path": ["includes"] }\nimport("nested.cdl");' : "",
    })));
    await addAsReference(store, file, tool, "/added/extra.cdl");
    const recursive = gateway.resolveImports.mock.calls.find(([, requests]) => requests.some((request) => request.kind === "import"));
    expect(recursive?.[0]).toBe("/added/extra.cdl");
    expect(recursive?.[2].importPaths).toEqual(["includes"]);
  });

  it("keeps imported C-header types when adding the first reference without a primary", async () => {
    const { store, gateway, file } = setup();
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
      canonicalPath: request.kind === "manual" ? "/added/extra.cdl" : "/added/types.h",
      content: request.kind === "manual" ? 'import_C("types.h"); signature sAdded { Added get(void); };' : "typedef int Added;",
    })));
    const tecsgen = { preprocess: vi.fn(async () => ({ stdout: "typedef int Added;", stderr: "", exitCode: 0, executableFound: true })) } as unknown as TecsgenGateway;
    await addAsReference(store, file, tecsgen, "/added/extra.cdl");
    expect(store.getPortTypeIndex().signatures.get("sAdded")?.valid).toBe(true);
    expect(store.filePath).toBeNull();
  });

  it("retains the added root context through nested C imports during whole-document validation", async () => {
    const { store, gateway, file } = setup();
    const extra = '__tool_info__("tecsgen") { "cpp": "root-cpp", "import_path": ["root-includes"] }\nimport("nested.cdl");';
    const nested = 'import_C("types.h"); signature sNested { Nested get(void); };';
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => ({ request,
      canonicalPath: request.kind === "manual" ? "/added/extra.cdl" : request.kind === "import" ? "/added/nested.cdl" : "/added/types.h",
      content: request.kind === "manual" ? extra : request.kind === "import" ? nested : "typedef int Nested;",
    })));
    const preprocess = vi.fn(async (_path: string, cpp?: string) => ({
      stdout: cpp === "root-cpp" ? "typedef int Nested;" : "typedef int Wrong;", stderr: "", exitCode: 0, executableFound: true,
    }));
    await addAsReference(store, file, { preprocess } as unknown as TecsgenGateway, "/added/extra.cdl");
    expect(store.getPortTypeIndex().signatures.get("sNested")?.valid).toBe(true);
    expect(preprocess.mock.calls.every(([, cpp]) => cpp === "root-cpp")).toBe(true);
    expect(gateway.resolveImports.mock.calls.filter(([, requests]) => requests.some((request) => request.kind === "import_C"))
      .every(([source, , options]) => source === "/added/nested.cdl" && options.importPaths.includes("root-includes"))).toBe(true);
  });

  it("does not apply an add when whole-document validation loses an import after successful discovery", async () => {
    const { store, gateway, file } = setup();
    let imports = 0;
    gateway.resolveImports.mockImplementation(async (_source, requests) => requests.map((request) => {
      if (request.kind === "manual") return { request, canonicalPath: "/added/extra.cdl", content: 'import("nested.cdl");' };
      if (request.specifier === "nested.cdl") {
        return { request, canonicalPath: "/added/nested.cdl", content: 'import("leaf.cdl");' };
      }
      return ++imports === 1 ? { request, canonicalPath: "/added/leaf.cdl", content: "" } : { request, error: "not-found" };
    }));
    const before = store.getDocument(); const session = store.getSessionSnapshot();
    await addAsReference(store, file, tool, "/added/extra.cdl");
    expect(store.getDocument()).toEqual(before); expect(store.getSessionSnapshot()).toEqual(session);
    expect(gateway.saveSession).not.toHaveBeenCalled();
  });

  it("ignores a delayed add when a newer edit changes the current anonymous primary", async () => {
    const { store, gateway, file } = setup(); await load(store, file); await newDocument(store, file);
    let resolve!: (results: ResolvedImport[]) => void;
    gateway.resolveImports.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    gateway.saveSession.mockClear();
    const adding = addAsReference(store, file, tool, "/added/extra.cdl");
    store.dispatch(new AddCellCommand("tRef", 20, 30));
    const before = store.getDocument();
    resolve([{ request: { kind: "manual", specifier: "/added/extra.cdl" }, canonicalPath: "/added/extra.cdl", content: "celltype tExtra {};" }]);
    await adding;
    expect(store.getDocument()).toEqual(before); expect(store.getReferenceFilePaths()).toEqual(["/ref.cdl"]);
    expect(gateway.saveSession).not.toHaveBeenCalled();
  });

  it("removes joins touching cleared primary cells and retains internal reference joins with consistent ports", async () => {
    const { store, file } = setup();
    await applyOpenResult(store, file, tool, { editable: { path: "/main.cdl", content: "cell t Primary {};" },
      references: [{ path: "/ref.cdl", content: "signature s { void f(void); }; celltype t { call s c; entry s e; };\n" +
        "cell t A { c = B.e; }; cell t B { c = Primary.e; };" }] });
    expect(store.getDocument().joinCount).toBe(2);
    await newDocument(store, file);
    expect(store.getDocument().joinCount).toBe(1);
    expect(store.getDocument().getCell(asCellId("B"))?.cports[0]?.joinId).toBeNull();
    expect(store.getDocument().getCell(asCellId("A"))?.cports[0]?.joinId).not.toBeNull();
    expect(store.getReport().items.filter((entry) => entry.severity === "error")).toEqual([]);
  });
});

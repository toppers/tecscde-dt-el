import { describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { applyOpenResult, openFromPath, save, saveAs, addAsReference } from "../../src/renderer/app/file-actions";
import { MoveCellsCommand } from "../../src/renderer/commands/cell-commands";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";

const text = "signature sMain { void run(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const opened = (path = "/main.cdl") => ({ editable: { path, content: text }, references: [] });
const tool = {} as TecsgenGateway;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const gateway = { resolveImports: vi.fn(async () => []), save: vi.fn(async (_path: string, _content: string) => {}),
    saveSession: vi.fn(async () => {}), confirmDiscardChanges: vi.fn(async () => true),
    openPath: vi.fn(async (path: string) => opened(path)),
    saveAs: vi.fn(async (_content: string, _suggestedName: string) => "/renamed.cdl") };
  return { store: new AppStore(), gateway, file: gateway as unknown as FileGateway };
}
const edit = (store: AppStore, dx: number) => store.dispatch(new MoveCellsCommand([asCellId("Main")], dx, 0));

describe("stage0 save checkpoints and load guards", () => {
  it("detects an Undo branch at the same depth and clears identical content", async () => {
    const { store, file } = setup();
    await applyOpenResult(store, file, tool, opened());
    edit(store, 5); await save(store, file); store.undo(); edit(store, 10);
    expect(store.isDirty()).toBe(true);
    store.undo(); edit(store, 5);
    expect(store.isDirty()).toBe(false);
  });
  it("records the written snapshot rather than edits made while saving", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened());
    edit(store, 5);
    const writing = deferred<void>(); gateway.save.mockImplementationOnce(() => writing.promise);
    const pending = save(store, file); edit(store, 5); writing.resolve(); await pending;
    expect(store.isDirty()).toBe(true);
    store.undo(); expect(store.isDirty()).toBe(false);
  });
  it("keeps a new document dirty when an old save completes", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const writing = deferred<void>(); gateway.save.mockImplementationOnce(() => writing.promise);
    const pending = save(store, file);
    await applyOpenResult(store, file, tool, opened("/new.cdl")); edit(store, 10);
    writing.resolve(); await pending;
    expect(store.filePath).toBe("/new.cdl"); expect(store.isDirty()).toBe(true);
  });
  it("retains successful source checkpoints after a later write fails", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, { ...opened(), references: [
      { path: "/ref.cdl", content: "signature sRef { void run(void); }; celltype tRef { entry sRef e; }; cell tRef Ref {};" },
    ] });
    edit(store, 5); store.dispatch(new MoveCellsCommand([asCellId("Ref")], 5, 0));
    gateway.save.mockImplementation(async (path: string) => { if (path === "/main.cdl") throw Error("write failed"); });
    await expect(save(store, file)).rejects.toThrow("write failed");
    expect(store.isSourceDirty("/ref.cdl")).toBe(false);
    expect(store.isSourceDirty("/main.cdl")).toBe(true);
  });
  it("ignores an old open result after a newer request even if that request cancels", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const opening = deferred<ReturnType<typeof opened>>(); gateway.openPath.mockImplementationOnce(() => opening.promise);
    const old = openFromPath(store, file, tool, "/old.cdl");
    await Promise.resolve();
    gateway.confirmDiscardChanges.mockResolvedValueOnce(false);
    await openFromPath(store, file, tool, "/cancelled.cdl");
    opening.resolve(opened("/old.cdl")); await old;
    expect(store.filePath).toBe("/main.cdl"); expect(store.isDirty()).toBe(true);
  });
  it("does not overwrite an edit made while opening another file", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened());
    const opening = deferred<ReturnType<typeof opened>>(); gateway.openPath.mockImplementationOnce(() => opening.promise);
    const pending = openFromPath(store, file, tool, "/late.cdl"); edit(store, 5);
    opening.resolve(opened("/late.cdl")); await pending;
    expect(store.filePath).toBe("/main.cdl"); expect(store.isDirty()).toBe(true);
  });
  it("preserves edits made while Save As waits for a chosen destination", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const writing = deferred<string>(); gateway.saveAs.mockImplementationOnce(() => writing.promise);
    const pending = saveAs(store, file); edit(store, 5); writing.resolve("/renamed.cdl"); await pending;
    expect(store.filePath).toBe("/renamed.cdl"); expect(store.isDirty()).toBe(true);
    store.undo(); expect(store.isDirty()).toBe(false);
  });
  it("waits for a save checkpoint before reporting close readiness and blocks new edits", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const writing = deferred<void>(); gateway.save.mockImplementationOnce(() => writing.promise);
    const pending = save(store, file); let ready = false;
    const closing = store.prepareClose().then(() => { ready = true; });
    edit(store, 5); await Promise.resolve(); expect(ready).toBe(false);
    writing.resolve(); await pending; await closing;
    expect(store.isDirty()).toBe(false);
    store.cancelClose(); edit(store, 5); expect(store.isDirty()).toBe(true);
  });
  it("holds an open result during close and applies it after cancellation", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened());
    const opening = deferred<ReturnType<typeof opened>>(); gateway.openPath.mockImplementationOnce(() => opening.promise);
    const pending = openFromPath(store, file, tool, "/held.cdl"); await store.prepareClose();
    opening.resolve(opened("/held.cdl")); await Promise.resolve(); await Promise.resolve();
    expect(store.filePath).toBe("/main.cdl"); store.cancelClose(); await pending;
    expect(store.filePath).toBe("/held.cdl");
  });
  it("does not write an obsolete Save As dialog after switching documents", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const choice = deferred<string | null>();
    Object.assign(gateway, { chooseSavePath: () => choice.promise });
    const pending = saveAs(store, file);
    await applyOpenResult(store, file, tool, opened("/new.cdl"));
    choice.resolve("/new.cdl"); await pending;
    expect(gateway.save).not.toHaveBeenCalled();
  });
  it("uses actual write order when an older Save As writes after a newer save", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const choice = deferred<string | null>(); Object.assign(gateway, { chooseSavePath: () => choice.promise });
    let sequence = 0;
    gateway.save = vi.fn(async () => ({ path: "/main.cdl", writeSequence: ++sequence })) as never;
    const older = saveAs(store, file); edit(store, 5); await save(store, file);
    expect(store.isDirty()).toBe(false);
    choice.resolve("/main.cdl"); await older;
    expect(store.isDirty()).toBe(true);
    store.undo(); expect(store.isDirty()).toBe(false);
  });
  it("restores an empty batch without generated type loading or a dummy primary", async () => {
    const { store, file } = setup(); const generatedTypes = vi.fn();
    await applyOpenResult(store, file, { generatedTypes } as never, {
      editable: { path: "", content: "" }, references: [], sources: [], primarySourceKey: null, sourceOrder: [],
    });
    expect(generatedTypes).not.toHaveBeenCalled(); expect(store.filePath).toBeNull();
    expect(store.getSessionSnapshot().sourceOrder).toEqual([]); expect(store.isDirty()).toBe(false);
  });
  it("includes the first Save As path in an initially empty session", async () => {
    const { store, file } = setup(); await saveAs(store, file);
    expect(store.getSessionSnapshot().sourceOrder).toEqual(["/renamed.cdl"]);
  });
  it("saves an empty primary independently of a sole restored reference", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, { editable: { path: "", content: "" },
      references: [{ path: "/ref.cdl", content: text }], primarySourceKey: null,
      sourceOrder: ["/ref.cdl"], sources: [{ path: "/ref.cdl", content: text }],
    });
    await saveAs(store, file);
    expect(gateway.saveAs.mock.calls[0]![0]).not.toContain("cell tMain Main");
    expect(store.getSessionSnapshot().sourceOrder).toEqual(["/ref.cdl", "/renamed.cdl"]);
  });
  it("keeps source order and checkpoints when adding after Save As", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, opened()); await saveAs(store, file); edit(store, 5);
    gateway.resolveImports.mockResolvedValue([{ request: { kind: "manual", specifier: "/extra.cdl" },
      canonicalPath: "/extra.cdl", content: "celltype tOther {};" }] as never);
    await addAsReference(store, file, tool, "/extra.cdl");
    expect(store.getDocument().sourceOrder).toEqual(["/renamed.cdl", "/extra.cdl"]);
    expect(store.isDirty()).toBe(true); expect(store.isSourceDirty("/extra.cdl")).toBe(false);
  });
  it("keeps a clean source clean when adding another file", async () => {
    const { store, file, gateway } = setup(); await applyOpenResult(store, file, tool, opened());
    gateway.resolveImports.mockResolvedValue([{ request: { kind: "manual", specifier: "/extra.cdl" },
      canonicalPath: "/extra.cdl", content: "celltype tOther {};" }] as never);
    await addAsReference(store, file, tool, "/extra.cdl"); expect(store.isDirty()).toBe(false);
  });
  it("keeps a clean source clean when reload changes the map order of equivalent joins", async () => {
    const { store, file, gateway } = setup();
    await applyOpenResult(store, file, tool, { editable: { path: "/main.cdl", content:
      "signature s { void f(void); }; celltype t { call s c; entry s e; };\n" +
      "cell t Z { c = Target.e; };\ncell t A { c = Target.e; };\ncell t Target {};" }, references: [] });
    gateway.resolveImports.mockResolvedValue([{ request: { kind: "manual", specifier: "/extra.cdl" },
      canonicalPath: "/extra.cdl", content: "celltype tOther {};" }] as never);
    await addAsReference(store, file, tool, "/extra.cdl"); expect(store.isDirty()).toBe(false);
  });
  it("suppresses a failed old open after a newer document is applied", async () => {
    const { store, file, gateway } = setup(); await applyOpenResult(store, file, tool, opened());
    let reject!: (error: Error) => void;
    gateway.openPath.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const old = openFromPath(store, file, tool, "/old.cdl");
    await applyOpenResult(store, file, tool, opened("/new.cdl")); reject(Error("old failure"));
    await expect(old).resolves.toBeUndefined(); expect(store.filePath).toBe("/new.cdl");
  });
  it("serializes Save As dialogs for the same primary and takes the next ticket after relocation", async () => {
    const { store, file, gateway } = setup(); await applyOpenResult(store, file, tool, opened()); edit(store, 5);
    const first = deferred<string | null>(); const choose = vi.fn().mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce("/second.cdl"); Object.assign(gateway, { chooseSavePath: choose });
    const one = saveAs(store, file); const two = saveAs(store, file);
    expect(choose).toHaveBeenCalledTimes(1);
    first.resolve("/first.cdl"); await one; await two;
    expect(store.filePath).toBe("/second.cdl"); expect(store.isDirty()).toBe(false);
  });
});

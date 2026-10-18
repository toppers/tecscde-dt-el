import { describe, expect, it, vi } from "vitest";
import { applyOpenResult, save } from "../../src/renderer/app/file-actions";
import { AppStore } from "../../src/renderer/app/store";
import { AddCellCommand, MoveCellsCommand, RenameCellCommand } from "../../src/renderer/commands/cell-commands";
import { CreateJoinCommand, DeleteJoinCommand } from "../../src/renderer/commands/join-commands";
import { asCellId, asJoinId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { ImportRequest, OpenResult } from "../../src/shared/ipc-types.js";

const referencePath = "/project/a/common.cdl";
const primaryPath = "/project/b/common.cdl";
const referenceText = "signature sRef { void run(void); }; celltype tRef { entry sRef e; }; cell tRef Ref {};";
const primaryText = "signature sMain { void run(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const tecsgen = {} as TecsgenGateway;

function gateway() {
  const saved = new Map<string, string>();
  const file = {
    resolveImports: vi.fn(async () => []),
    save: vi.fn(async (path: string, text: string) => { saved.set(path, text); }),
    saveSession: vi.fn(async () => {}),
  } as unknown as FileGateway;
  return { file, saved };
}

describe("editing multiple opened CDL files", () => {
  it("saves each changed file to its own path and restores its cell layout", async () => {
    const { file, saved } = gateway();
    const store = new AppStore();
    const opened: OpenResult = {
      editable: { path: primaryPath, content: primaryText },
      references: [{ path: referencePath, content: referenceText }],
    };
    await applyOpenResult(store, file, tecsgen, opened);

    expect(store.getDocument().getCell(asCellId("Ref"))?.editable).toBe(true);
    expect(store.getDocument().getCell(asCellId("Main"))?.editable).toBe(true);
    const initialMainX = store.getDocument().getCell(asCellId("Main"))!.x;
    store.dispatch(new MoveCellsCommand([asCellId("Ref")], 5, 0));
    store.dispatch(new MoveCellsCommand([asCellId("Main")], 10, 0));
    store.dispatch(new AddCellCommand("tRef", 100, 100, referencePath));
    const added = store.getDocument().cellValues().find((cell) => cell.name !== "Ref" && cell.name !== "Main");
    expect(added?.locale).toBe(referencePath);
    expect(store.isSourceDirty(referencePath)).toBe(true);
    await save(store, file);

    expect(saved.has(referencePath)).toBe(true);
    expect(saved.has(primaryPath)).toBe(true);
    expect(saved.get(referencePath)).toContain("cell tRef Ref");
    expect(saved.get(referencePath)).not.toContain('"ports": {}');
    expect(saved.get(referencePath)).toContain(`cell tRef ${added!.name}`);
    expect(saved.get(referencePath)).not.toContain("cell tMain Main");
    expect(saved.get(primaryPath)).toContain("cell tMain Main");
    expect(saved.get(primaryPath)).not.toContain("cell tRef Ref");
    expect(saved.get(primaryPath)).not.toContain(added!.name);
    expect(store.isDirty()).toBe(false);

    const reopened = new AppStore();
    await applyOpenResult(reopened, file, tecsgen, {
      editable: { path: primaryPath, content: saved.get(primaryPath)! },
      references: [{ path: referencePath, content: saved.get(referencePath)! }],
    });
    expect(reopened.getDocument().getCell(asCellId("Ref"))?.x).toBe(15);
    expect(reopened.getDocument().getCell(asCellId("Main"))?.x).toBe(initialMainX + 10);
  });

  it("edits transitively imported CDL and saves it to its own path", async () => {
    const { file, saved } = gateway();
    file.resolveImports = vi.fn(async (_path: string, requests: readonly ImportRequest[]) => requests.map((request) => ({
      request, canonicalPath: referencePath, content: referenceText,
    })));
    const store = new AppStore();
    await applyOpenResult(store, file, tecsgen, {
      editable: { path: primaryPath, content: `import("common.cdl"); ${primaryText}` },
      references: [],
    });

    expect(store.getDocument().getCell(asCellId("Ref"))?.editable).toBe(true);
    store.dispatch(new MoveCellsCommand([asCellId("Ref")], 5, 0));
    await save(store, file);
    expect(saved.has(referencePath)).toBe(true);
    expect(saved.get(referencePath)).toContain("cell tRef Ref");
  });

  it("does not rewrite a target CDL when only another file's join changes", async () => {
    const { file, saved } = gateway();
    const store = new AppStore();
    await applyOpenResult(store, file, tecsgen, {
      editable: { path: primaryPath, content: "celltype tMain { call sRef c; }; cell tMain Main {};" },
      references: [{ path: referencePath, content: referenceText }],
    });

    store.dispatch(new CreateJoinCommand(asCellId("Main"), "c", null, asCellId("Ref"), "e"));
    expect(store.getDocument().joinCount).toBe(1);
    expect(store.isSourceDirty(referencePath)).toBe(false);
    await save(store, file);
    expect(saved.has(referencePath)).toBe(false);
    expect(saved.get(primaryPath)).toContain("c = Ref.e;");
  });

  it("does not restore a deleted join that was resolved on load", async () => {
    const { file, saved } = gateway();
    const store = new AppStore();
    await applyOpenResult(store, file, tecsgen, {
      editable: { path: primaryPath, content: "celltype tMain { call sRef c; }; cell tMain Main { c = Ref.e; };" },
      references: [{ path: referencePath, content: referenceText }],
    });
    expect(store.getDocument().joinCount).toBe(1);

    store.dispatch(new DeleteJoinCommand(asJoinId("Main.c")));
    await save(store, file);

    expect(saved.get(primaryPath)).not.toContain("c = Ref.e;");
  });

  it("updates another CDL when a joined target cell is renamed", async () => {
    const { file, saved } = gateway();
    const store = new AppStore();
    await applyOpenResult(store, file, tecsgen, {
      editable: { path: primaryPath, content: "celltype tMain { call sRef c; }; cell tMain Main { c = Ref.e; };" },
      references: [{ path: referencePath, content: referenceText }],
    });

    store.dispatch(new RenameCellCommand(asCellId("Ref"), "RenamedRef"));
    expect(store.isSourceDirty(referencePath)).toBe(true);
    expect(store.isSourceDirty(primaryPath)).toBe(true);
    await save(store, file);

    expect(saved.get(referencePath)).toContain("cell tRef RenamedRef");
    expect(saved.get(primaryPath)).toContain("c = RenamedRef.e;");
  });

  it("pastes a cell into the selected imported CDL", async () => {
    const { file, saved } = gateway();
    const store = new AppStore();
    await applyOpenResult(store, file, tecsgen, {
      editable: { path: primaryPath, content: primaryText },
      references: [{ path: referencePath, content: referenceText }],
    });
    store.setSelection(SelectionState.ofCells([asCellId("Ref")]));
    store.copySelection({ writeText: vi.fn(async () => {}) });

    store.pasteClipboard(undefined);

    const pasted = store.getDocument().cellValues().find((cell) => cell.name !== "Ref" && cell.name !== "Main");
    expect(pasted?.locale).toBe(referencePath);
    await save(store, file);
    expect(saved.get(referencePath)).toContain(`cell tRef ${pasted!.name}`);
    expect(saved.get(primaryPath)).not.toContain(pasted!.name);
  });
});

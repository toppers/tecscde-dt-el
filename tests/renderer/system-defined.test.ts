// [[TECSCDE-DT-EL内部仕様]] 第3章3.2節・第7C章7.7.4節 — システム定義CDL（`-S`）と`systemDefined`。

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { AppStore } from "../../src/renderer/app/store";
import { applyOpenResult, save } from "../../src/renderer/app/file-actions";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

function load(mainPath: string, options: { systemDirs?: string[]; allow?: boolean } = {}) {
  return CdlDocumentLoader.loadSources(
    [
      { text: celltypesText, fileName: "celltypes.cdl", sourcePath: "/proj/celltypes.cdl", editable: true },
      { text: mainText, fileName: "main.cde", sourcePath: mainPath, editable: true },
    ],
    { systemDirs: options.systemDirs ?? [], allowEditSystemDefined: options.allow ?? false },
  ).document;
}

describe("CdlDocumentLoader — system-defined CDL", () => {
  it("marks cells from a source under -S as systemDefined and not editable by default", () => {
    const doc = load("/sys/main.cde", { systemDirs: ["/sys"] });
    const cells = doc.cellValues().filter((cell) => cell.locale === "/sys/main.cde");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.systemDefined).toBe(true);
      expect(cell.editable).toBe(false);
    }
  });

  it("keeps cells from sources outside -S as user-defined and editable", () => {
    const doc = load("/proj/main.cde", { systemDirs: ["/sys"] });
    for (const cell of doc.cellValues()) {
      expect(cell.systemDefined).toBe(false);
      expect(cell.editable).toBe(true);
    }
  });

  it("treats everything as user-defined when there is no -S", () => {
    const doc = load("/sys/main.cde");
    for (const cell of doc.cellValues()) expect(cell.systemDefined).toBe(false);
  });

  it("makes system-defined cells editable when allowEditSystemDefined is true, but still marks them", () => {
    const doc = load("/sys/main.cde", { systemDirs: ["/sys"], allow: true });
    const cells = doc.cellValues().filter((cell) => cell.locale === "/sys/main.cde");
    for (const cell of cells) {
      expect(cell.systemDefined).toBe(true);
      expect(cell.editable).toBe(true);
    }
  });

  it("gives a read-only system source no template, so it is never written back", () => {
    const doc = load("/sys/main.cde", { systemDirs: ["/sys"] });
    expect(doc.sourceTemplates.has("/sys/main.cde")).toBe(false);
    expect(() => CdlSerializer.serializeSource(doc, "/sys/main.cde")).toThrow();
  });

  it("respects directory boundaries (/sysx is not under /sys)", () => {
    const doc = load("/sysx/main.cde", { systemDirs: ["/sys"] });
    for (const cell of doc.cellValues()) expect(cell.systemDefined).toBe(false);
  });
});

describe("applyOpenResult / save with -S", () => {
  const gateway = {
    resolveImports: async () => [],
    saveSession: async () => undefined,
  } as unknown as FileGateway;
  const tecsgen = {} as unknown as TecsgenGateway;
  const open = (path: string, systemDirs?: string[]) => ({
    editable: { path, content: mainText },
    references: [{ path: "/proj/celltypes.cdl", content: celltypesText }],
    ...(systemDirs ? { systemDirs } : {}),
  });

  it("keeps systemDirs in the store and applies them to the loaded document", async () => {
    const store = new AppStore();
    await applyOpenResult(store, gateway, tecsgen, open("/proj/main.cde", ["/proj"]));
    expect(store.getSystemDirs()).toEqual(["/proj"]);
    expect(store.getDocument().cellValues().every((cell) => cell.systemDefined && !cell.editable)).toBe(true);
  });

  it("honours allowEditSystemDefined from the store", async () => {
    const store = new AppStore();
    store.setAllowEditSystemDefined(true);
    await applyOpenResult(store, gateway, tecsgen, open("/proj/main.cde", ["/proj"]));
    expect(store.getDocument().cellValues().every((cell) => cell.systemDefined && cell.editable)).toBe(true);
  });

  it("does not save when the main file is a read-only system-defined file", async () => {
    const store = new AppStore();
    await applyOpenResult(store, gateway, tecsgen, open("/proj/main.cde", ["/proj"]));
    expect(store.isEditingFileReadOnlySystemDefined()).toBe(true);
    const write = vi.fn();
    await save(store, { ...gateway, save: write } as unknown as FileGateway);
    expect(write).not.toHaveBeenCalled();
  });

  it("still saves a normal file when -S points elsewhere", async () => {
    const store = new AppStore();
    await applyOpenResult(store, gateway, tecsgen, open("/proj/main.cde", ["/sys"]));
    expect(store.isEditingFileReadOnlySystemDefined()).toBe(false);
    const write = vi.fn().mockResolvedValue(undefined);
    await save(store, { ...gateway, save: write } as unknown as FileGateway);
    expect(write).toHaveBeenCalled();
  });
});

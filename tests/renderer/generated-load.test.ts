import { describe, expect, it, vi } from "vitest";
import { applyOpenResult } from "../../src/renderer/app/file-actions";
import { AppStore } from "../../src/renderer/app/store";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import { asCellId } from "../../src/renderer/model/ids";

const opened = {
  editable: { path: "/project/main.cdl", content: "cell nPlugin::tGenerated Main {};" },
  references: [],
  optionsFilePath: "/project/build.tecsgen-opts",
};

const fileGateway = { resolveImports: async () => [] } as unknown as FileGateway;

describe("Plugin type resolution on open", () => {
  it("adds generated types to the model without adding generated cells to the document", async () => {
    const generatedTypes = vi.fn().mockResolvedValue({
      result: { stdout: "", stderr: "", exitCode: 0, executableFound: true },
      sources: [{ fileName: "tmp_Plugin_0.cdl", content: `namespace nPlugin {
  celltype tGenerated { call sPort cPort; };
  cell tGenerated Helper {};
};` }],
    });
    const store = new AppStore();
    await applyOpenResult(store, fileGateway, { generatedTypes } as unknown as TecsgenGateway, opened);

    expect(generatedTypes).toHaveBeenCalledWith(["-k", "utf8", "/project/main.cdl"], opened.editable.path, opened.optionsFilePath);
    expect(store.getDocument().getCell(asCellId("Main"))?.celltypeUnresolved).toBe(false);
    expect(store.getDocument().getCell(asCellId("Helper"))).toBeUndefined();
    expect(store.getReferenceFilePaths()).toEqual([]);
    expect(store.getOptionsFilePath()).toBe(opened.optionsFilePath);
    expect(store.getGeneratedTypeSources()).toHaveLength(1);
  });

  it("keeps the document open and reports a preview failure", async () => {
    const generatedTypes = vi.fn().mockRejectedValue(new Error("preview failed"));
    const store = new AppStore();
    await applyOpenResult(store, fileGateway, { generatedTypes } as unknown as TecsgenGateway, opened);
    expect(store.getDocument().getCell(asCellId("Main"))?.celltypeUnresolved).toBe(true);
    expect(store.getReport().items.some((item) => item.code === "W-PLUGIN-TYPE-LOAD")).toBe(true);
  });

  it("explains how to fix it when tecsgen is not found", async () => {
    const generatedTypes = vi.fn().mockResolvedValue({
      result: { stdout: "", stderr: "", exitCode: null, executableFound: false },
      sources: [],
    });
    const store = new AppStore();
    await applyOpenResult(store, fileGateway, { generatedTypes } as unknown as TecsgenGateway, opened);

    const message = store.getReport().items.find((item) => item.code === "W-PLUGIN-TYPE-LOAD")?.message;
    expect(message).toContain("tecsgen が見つかりません");
    expect(message).toContain("TECSGEN_COMMAND");
    expect(message).not.toContain("Error:");
  });

  it("ignores partial generated CDL when tecsgen exits with an error", async () => {
    const generatedTypes = vi.fn().mockResolvedValue({
      result: { stdout: "G1014 while reading CDL", stderr: "", exitCode: 1, executableFound: true },
      sources: [{ fileName: "partial.cdl", content: "celltype tGenerated {};" }],
    });
    const store = new AppStore();
    await applyOpenResult(store, fileGateway, { generatedTypes } as unknown as TecsgenGateway, opened);

    expect(store.getGeneratedTypeSources()).toEqual([]);
    expect(store.getDocument().getCell(asCellId("Main"))?.celltypeUnresolved).toBe(true);
    expect(store.getReport().items.some((item) => item.code === "W-PLUGIN-TYPE-LOAD")).toBe(true);
    expect(store.getReport().items.find((item) => item.code === "W-PLUGIN-TYPE-LOAD")?.message).toContain("G1014");
  });
});

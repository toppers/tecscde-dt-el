import { describe, expect, it, vi } from "vitest";
import { restoreSession } from "../../src/main/session-restore.js";
import type { OpenResult, SessionSnapshot, TecsgenOptionsFile } from "../../src/shared/ipc-types.js";

const empty: OpenResult = { editable: { path: "", content: "" }, references: [], primarySourceKey: null, sourceOrder: [], sources: [] };

function setup() {
  return {
    openBatch: vi.fn(async () => empty),
    parseTecsgenOptionsFile: vi.fn<(_: string) => Promise<TecsgenOptionsFile>>().mockResolvedValue({
      cdlFiles: ["/different.cdl"], importPaths: ["new", "new"], systemDirs: ["/sys"], defineMacros: [],
    }),
  };
}

const session: SessionSnapshot = {
  editablePath: "/primary.cde", referencePaths: ["/ref.cdl"], sourceOrder: ["/primary.cde", "/ref.cdl"],
  extraImportPaths: ["old"], optionsFilePath: "/project/options.tecsgen-opts",
};

describe("restoreSession", () => {
  it("uses the stored source set and order while adopting both context arrays from one options parse", async () => {
    const file = setup();
    const result = await restoreSession(file, session);
    expect(file.openBatch).toHaveBeenCalledWith({ primaryPath: "/primary.cde", referencePaths: ["/ref.cdl"], sourceOrder: ["/primary.cde", "/ref.cdl"] });
    expect(file.parseTecsgenOptionsFile).toHaveBeenCalledExactlyOnceWith(session.optionsFilePath);
    expect(result.extraImportPaths).toEqual(["new", "new"]);
    expect(result.systemDirs).toEqual(["/sys"]);
    expect(result.optionsFilePath).toBe(session.optionsFilePath);
  });

  it("adopts empty successful options arrays instead of reverting to saved values", async () => {
    const file = setup();
    file.parseTecsgenOptionsFile.mockResolvedValue({ cdlFiles: [], importPaths: [], systemDirs: [], defineMacros: [] });
    const result = await restoreSession(file, session);
    expect(result.extraImportPaths).toEqual([]);
    expect(result.systemDirs).toEqual([]);
    expect(file.openBatch).toHaveBeenCalledWith({ primaryPath: "/primary.cde", referencePaths: ["/ref.cdl"], sourceOrder: ["/primary.cde", "/ref.cdl"] });
  });

  it("retains the options base and saved paths if only options parsing fails", async () => {
    const file = setup();
    file.parseTecsgenOptionsFile.mockRejectedValue(new Error("missing opts"));
    const result = await restoreSession(file, session);
    expect(result.extraImportPaths).toEqual(["old"]);
    expect(result.optionsFilePath).toBe(session.optionsFilePath);
    expect(result.systemDirs).toEqual([]);
  });

  it("drops relative fallback paths without an options base but retains absolute paths and duplicates", async () => {
    const file = setup();
    const result = await restoreSession(file, { editablePath: null, referencePaths: [], extraImportPaths: ["relative", "/inc", "C:\\inc", "/inc"] });
    expect(file.parseTecsgenOptionsFile).not.toHaveBeenCalled();
    expect(result.extraImportPaths).toEqual(["/inc", "C:\\inc", "/inc"]);
  });

  it.each([{ referencePaths: [] }, { referencePaths: ["/ref.cdl"] }])("restores null-primary session $referencePaths without promoting a reference", async ({ referencePaths }) => {
    const file = setup();
    await restoreSession(file, { editablePath: null, referencePaths, extraImportPaths: [] });
    expect(file.openBatch).toHaveBeenCalledWith({ primaryPath: null, referencePaths, sourceOrder: referencePaths });
  });

  it("propagates source I/O failures so the caller can fall back as a whole", async () => {
    const file = setup();
    file.openBatch.mockRejectedValue(new Error("missing source"));
    await expect(restoreSession(file, session)).rejects.toThrow("missing source");
  });
});

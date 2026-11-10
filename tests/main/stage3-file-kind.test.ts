import { describe, expect, it } from "vitest";
import { fileKind } from "../../src/shared/file-kind.js";

describe("stage 3 file kind", () => {
  it.each([["日本 語/Test.CDE", "cdl"], ["a.CdL", "cdl"], ["a.TeCsGeN-OpTs", "options"], ["a.cdl.txt", undefined]])
    ("classifies %s without changing its path", (path, kind) => expect(fileKind(path)).toBe(kind));
});

// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] —
// extract() が parse() で得た Tree を解放すること（WASM側のメモリを残さない）を検証する。

import { afterEach, describe, expect, it, vi } from "vitest";
import { CdeclExtractor } from "../../src/renderer/cdecl/extractor";
import { CdeclGrammar } from "../../src/renderer/cdecl/grammar";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CdeclExtractor.extract — tree release", () => {
  it("deletes the parse tree exactly once and still returns the extracted types", () => {
    const parser = CdeclGrammar.parserInstance;
    const realParse = parser.parse.bind(parser);
    let deleted = 0;
    vi.spyOn(parser, "parse").mockImplementation((...args: Parameters<typeof realParse>) => {
      const tree = realParse(...args);
      if (tree) {
        const realDelete = tree.delete.bind(tree);
        tree.delete = () => {
          deleted += 1;
          realDelete();
        };
      }
      return tree;
    });

    const result = CdeclExtractor.extract("typedef unsigned char uint8_t; struct Point { int x; int y; };");

    expect(deleted).toBe(1);
    // Tree解放後も、結果はノードを参照しない純粋なデータなので読める。
    expect(result.typedefs.get("uint8_t")).toMatchObject({ kind: "primitive" });
    expect(result.structs.get("Point")?.members.map((member) => member.name)).toEqual(["x", "y"]);
  });

  it("returns the same result when called repeatedly", () => {
    const source = "typedef int IntArray4[4]; typedef void *VP_INT;";
    const first = CdeclExtractor.extract(source);
    for (let i = 0; i < 20; i += 1) CdeclExtractor.extract(source);
    const again = CdeclExtractor.extract(source);
    expect([...again.typedefs.keys()].sort()).toEqual([...first.typedefs.keys()].sort());
    expect(again.hasErrors).toBe(first.hasErrors);
  });

  it("still deletes the tree when the walk throws", () => {
    const parser = CdeclGrammar.parserInstance;
    const fakeTree = {
      get rootNode(): never {
        throw new Error("walk failed");
      },
      delete: vi.fn(),
    };
    vi.spyOn(parser, "parse").mockReturnValue(fakeTree as never);

    expect(() => CdeclExtractor.extract("typedef int x;")).toThrow("walk failed");
    expect(fakeTree.delete).toHaveBeenCalledTimes(1);
  });
});

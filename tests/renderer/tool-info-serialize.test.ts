import { describe, expect, it } from "vitest";
import { ToolInfoValidator } from "../../src/renderer/cdl/tool-info";

const paper = { size: "A4", orientation: "LANDSCAPE" } as const;

describe("ToolInfoValidator.serializeTecscde", () => {
  it("omits empty cell_list / join_list because tecsgen rejects empty objects (G1016)", () => {
    const json = ToolInfoValidator.serializeTecscde(paper, {}, {}, {});

    expect(json).not.toContain("{}");
    expect(JSON.parse(json)).toEqual({ paper });
  });

  it("keeps non-empty lists and omits only the empty one", () => {
    const cellList = { c1: { location: [10, 10, 25, 15], region: "::A" } };
    const json = ToolInfoValidator.serializeTecscde(paper, cellList as never, {}, {});

    expect(JSON.parse(json)).toEqual({ paper, cell_list: cellList });
  });

  it("round-trips: output without the lists parses back to empty lists", () => {
    const json = ToolInfoValidator.serializeTecscde(paper, {}, {}, {});

    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);

    expect(diagnostics).toEqual([]);
    expect(parsed.cellList).toEqual({});
    expect(parsed.joinList).toEqual({});
    expect(parsed.paper).toEqual(paper);
  });
});

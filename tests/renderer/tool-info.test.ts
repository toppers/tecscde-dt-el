import { describe, expect, it } from "vitest";
import { ToolInfoValidator, type ArrayElementRecord } from "../../src/renderer/cdl/tool-info";
import { W_CODES } from "../../src/renderer/cdl/messages";

const paper = { size: "A4", orientation: "LANDSCAPE" } as const;

describe("ToolInfoValidator - array_elements parsing and validation (audit #24)", () => {
  it("parses valid array_elements and treats it as a known field", () => {
    const json = JSON.stringify({
      paper,
      array_elements: [
        { cell: "c1", direction: "call", port: "cPort", element_count: 5 },
        { cell: "c2", direction: "entry", port: "ePort", element_count: 10 },
      ],
    });

    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(diagnostics).toEqual([]);
    expect(parsed.unknownFields).toEqual({});
    expect(parsed.arrayElements).toEqual([
      { cell: "c1", direction: "call", port: "cPort", element_count: 5 },
      { cell: "c2", direction: "entry", port: "ePort", element_count: 10 },
    ]);
  });

  it("warns with LAYOUT_DISCARDED when array_elements is not an array", () => {
    const json = JSON.stringify({
      paper,
      array_elements: "invalid_not_an_array",
    });

    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.code).toBe(W_CODES.LAYOUT_DISCARDED);
    expect(diagnostics[0]?.message).toContain("array_elements (配列ではありません)");
    expect(parsed.arrayElements).toBeUndefined();
    expect(parsed.unknownFields).toEqual({});
  });

  it("discards invalid element entries with LAYOUT_DISCARDED warning", () => {
    const json = JSON.stringify({
      paper,
      array_elements: [
        { cell: "", direction: "call", port: "cPort", element_count: 5 }, // empty cell
        { cell: "c1", direction: "invalid_dir", port: "cPort", element_count: 5 }, // invalid dir
        { cell: "c1", direction: "call", port: "  ", element_count: 5 }, // whitespace port
        { cell: "c1", direction: "call", port: "cPort", element_count: 0 }, // count < 1
        { cell: "c1", direction: "call", port: "cPort", element_count: 1001 }, // count > 1000
        { cell: "c1", direction: "call", port: "cPort", element_count: 3.5 }, // non-integer
        { cell: "validCell", direction: "call", port: "validPort", element_count: 3 }, // valid
      ],
    });

    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(diagnostics.length).toBe(6);
    expect(diagnostics.every((d) => d.code === W_CODES.LAYOUT_DISCARDED)).toBe(true);
    expect(parsed.arrayElements).toEqual([
      { cell: "validCell", direction: "call", port: "validPort", element_count: 3 },
    ]);
  });

  it("excludes both duplicate keys when identical cell/direction/port appears in same block", () => {
    const json = JSON.stringify({
      paper,
      array_elements: [
        { cell: "c1", direction: "call", port: "cPort", element_count: 2 },
        { cell: "c1", direction: "call", port: "cPort", element_count: 4 }, // duplicate of above
        { cell: "c1", direction: "entry", port: "cPort", element_count: 3 }, // different direction -> valid
        { cell: "c2", direction: "call", port: "cPort", element_count: 5 }, // different cell -> valid
      ],
    });

    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.code).toBe(W_CODES.LAYOUT_DISCARDED);
    expect(diagnostics[0]?.message).toContain("重複");
    // Duplicate key c1/call/cPort must be completely excluded
    expect(parsed.arrayElements).toEqual([
      { cell: "c1", direction: "entry", port: "cPort", element_count: 3 },
      { cell: "c2", direction: "call", port: "cPort", element_count: 5 },
    ]);
  });
});

describe("ToolInfoValidator - array_elements serialization (audit #24)", () => {
  it("serializes array_elements when non-empty", () => {
    const elements: ArrayElementRecord[] = [
      { cell: "c1", direction: "call", port: "cPort", element_count: 3 },
    ];
    const json = ToolInfoValidator.serializeTecscde(paper, {}, {}, {}, elements);
    const parsed = JSON.parse(json);
    expect(parsed.array_elements).toEqual([
      { cell: "c1", direction: "call", port: "cPort", element_count: 3 },
    ]);
  });

  it("omits array_elements key when arrayElements is empty or undefined", () => {
    const jsonEmpty = ToolInfoValidator.serializeTecscde(paper, {}, {}, {}, []);
    expect(JSON.parse(jsonEmpty).array_elements).toBeUndefined();

    const jsonUndef = ToolInfoValidator.serializeTecscde(paper, {}, {}, {});
    expect(JSON.parse(jsonUndef).array_elements).toBeUndefined();
  });

  it("supports object-style argument passing to serializeTecscde", () => {
    const elements: ArrayElementRecord[] = [
      { cell: "c2", direction: "entry", port: "ePort", element_count: 4 },
    ];
    const json = ToolInfoValidator.serializeTecscde({
      paper,
      cellList: {},
      joinList: {},
      unknownFields: {},
      arrayElements: elements,
    });
    const parsed = JSON.parse(json);
    expect(parsed.array_elements).toEqual([
      { cell: "c2", direction: "entry", port: "ePort", element_count: 4 },
    ]);
  });
});
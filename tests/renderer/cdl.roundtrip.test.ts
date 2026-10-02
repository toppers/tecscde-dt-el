// TECSCDE-TS内部仕様 11.3 — 最初の実装単位: モデル＋CDLパーサ/シリアライザのround trip検証。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { CdlGrammar } from "../../src/renderer/cdl/grammar";
import { ChangeRegionCommand, RenameCellCommand } from "../../src/renderer/commands";
import { asCellId, asRegionId } from "../../src/renderer/model/ids";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

describe("CDL round trip", () => {
  it("parses the sample fixture without errors", () => {
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(document.cellCount).toBe(3);
    expect(document.joinCount).toBe(2);
    expect(document.celltypeCount).toBe(3);
  });

  it("serialize -> parse reproduces the same cells, attrs, and joins", () => {
    const first = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);

    const serialized = CdlSerializer.serialize(first.document);

    const second = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: serialized, fileName: "main.cde", editable: true },
    ]);

    expect(second.document.cellCount).toBe(first.document.cellCount);
    expect(second.document.joinCount).toBe(first.document.joinCount);

    for (const cell of first.document.cellValues()) {
      const roundTripped = second.document.getCell(cell.id);
      expect(roundTripped).toBeDefined();
      expect(roundTripped?.celltypeName).toBe(cell.celltypeName);
      expect(roundTripped?.attrs).toEqual(cell.attrs);
      expect(roundTripped?.x).toBe(cell.x);
      expect(roundTripped?.y).toBe(cell.y);
    }
  });

  it("preserves unknown / uninterpreted tecsgen tool-info fields across a round trip (5.1.2)", () => {
    const first = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    expect(first.document.toolInfoTecsgen.baseDir).toBe("E:/example/project");

    const serialized = CdlSerializer.serialize(first.document);
    const second = CdlDocumentLoader.loadSources([{ text: serialized, fileName: "main.cde", editable: true }]);

    expect(second.document.toolInfoTecsgen.baseDir).toBe("E:/example/project");
    expect(second.document.toolInfoTecsgen.importPath).toEqual(["./include"]);
  });

  it("reports a warning (not an error) for a join whose target cell is missing", () => {
    const text = `
      cell tController c1 {
        cLog = doesNotExist.eLog;
      };
    `;
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text, fileName: "main.cde", editable: true },
    ]);
    expect(diagnostics.some((d) => d.code === "W-MISSING-JOIN-TARGET")).toBe(true);
    expect(document.cellCount).toBe(1); // 9.1.2: エラーで中断せず、パースできた範囲は反映する
  });

  it("does not abort parsing on a syntax error elsewhere in the file (9.1.2)", () => {
    const text = `
      cell tSensor cSensor1 {
      };

      @@@ garbage token @@@

      cell tLogger cLogger1 {
        level = 1;
      };
    `;
    const { document, diagnostics } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text, fileName: "main.cde", editable: true },
    ]);
    expect(document.cellCount).toBe(2);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("preserves import / import_C statements verbatim across a round trip", () => {
    const text = `
import("celltypes.cdl");
import_C("<stdio.h>");

cell tLogger cLogger1 {
  level = 1;
};
`;
    const first = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text, fileName: "main.cde", editable: true },
    ]);
    expect(first.document.preservedImports).toEqual([
      'import("celltypes.cdl");',
      'import_C("<stdio.h>");',
    ]);

    const serialized = CdlSerializer.serialize(first.document);
    expect(serialized).toContain('import("celltypes.cdl");');
    expect(serialized).toContain('import_C("<stdio.h>");');

    const second = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: serialized, fileName: "main.cde", editable: true },
    ]);
    expect(second.document.preservedImports).toEqual(first.document.preservedImports);
  });

  it("emits CDL that the tecsgen grammar accepts (外部仕様2.2)", () => {
    // 内部仕様11.3: 往復の一致だけで完了としない。出力を文法に通し、
    // ERROR/MISSING がゼロであることを併せて確認する。
    const { document } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    const serialized = CdlSerializer.serialize(document);

    const tree = CdlGrammar.parserInstance.parse(serialized);
    const root = tree?.rootNode;
    expect(root).toBeDefined();

    const problems: string[] = [];
    const walk = (node: import("web-tree-sitter").Node): void => {
      if (node.type === "ERROR" || node.isMissing) {
        problems.push(
          `${node.isMissing ? "MISSING" : "ERROR"} @${node.startPosition.row + 1}:${node.startPosition.column + 1}`,
        );
        return;
      }
      if (!node.hasError) return;
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child) walk(child);
      }
    };
    walk(root!);
    expect(problems).toEqual([]);
    tree?.delete();
  });
});

describe("region load and change", () => {
  const source = `// 日本語の説明を保持
namespace N {
  region A {
    // cell comment
    /* block note
       for c1 */
    cell tLogger c1 { level = 1; };
  };
  region B {
    // keep this declaration
  };
};
`;

  it("loads nested cells and keeps their region through a move and save", () => {
    const first = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: source, fileName: "main.cde", editable: true },
    ]);
    expect(first.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(first.document.getCell(asCellId("c1"))?.regionId).toBe("::N::A");
    expect(first.document.regions.findById(asRegionId("::N::A"))?.cellIds).toEqual([asCellId("c1")]);

    const changed = new ChangeRegionCommand(asCellId("c1"), asRegionId("::N::B")).apply(first.document);
    expect(changed.getCell(asCellId("c1"))?.regionId).toBe("::N::B");
    expect(changed.regions.findById(asRegionId("::N::A"))?.cellIds).toEqual([]);
    expect(changed.regions.findById(asRegionId("::N::B"))?.cellIds).toEqual([asCellId("c1")]);

    const text = CdlSerializer.serialize(changed);
    expect(text).toContain("// 日本語の説明を保持");
    expect(text).toContain("// keep this declaration");
    expect(text.indexOf("// cell comment")).toBeGreaterThan(text.indexOf("region B"));
    expect(text.indexOf("/* block note")).toBeGreaterThan(text.indexOf("region B"));
    const second = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text, fileName: "main.cde", editable: true },
    ]);
    expect(second.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(second.document.getCell(asCellId("c1"))?.regionId).toBe("::N::B");
    expect(second.document.regions.findById(asRegionId("::N::B"))?.cellIds).toEqual([asCellId("c1")]);
  });

  it("rejects a missing or reference-only destination", () => {
    const reference = `region Shared { cell tLogger ref { level = 2; }; };`;
    const { document } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: reference, fileName: "shared.cdl", editable: false },
      { text: source, fileName: "main.cde", editable: true },
    ]);
    expect(new ChangeRegionCommand(asCellId("c1"), asRegionId("::Missing")).apply(document)).toBe(document);
    expect(new ChangeRegionCommand(asCellId("c1"), asRegionId("::Shared")).apply(document)).toBe(document);
    expect(new ChangeRegionCommand(asCellId("ref"), asRegionId("::N::B")).apply(document)).toBe(document);
  });

  it("keeps an attached comment when a cell is renamed and moved", () => {
    const first = CdlDocumentLoader.loadSingle(source, "main.cde");
    const renamed = new RenameCellCommand(asCellId("c1"), "c2").apply(first.document);
    const moved = new ChangeRegionCommand(asCellId("c1"), asRegionId("::N::B")).apply(renamed);
    const text = CdlSerializer.serialize(moved);
    expect(text.indexOf("// cell comment")).toBeGreaterThan(text.indexOf("region B"));
    const loaded = CdlDocumentLoader.loadSingle(text, "main.cde");
    expect(loaded.document.cellValues().map((cell) => [cell.name, cell.regionId])).toEqual([["c2", "::N::B"]]);
  });

  it("moves a nested cell to root and restores a legacy flat cell from layout metadata", () => {
    const first = CdlDocumentLoader.loadSingle(source, "main.cde");
    const atRoot = new ChangeRegionCommand(asCellId("c1"), asRegionId("::")).apply(first.document);
    const roundTripped = CdlDocumentLoader.loadSingle(CdlSerializer.serialize(atRoot), "main.cde");
    expect(roundTripped.document.getCell(asCellId("c1"))?.regionId).toBe("::");

    const flat = `region A {};
cell tLogger c1 {};
__tool_info__("tecscde") {"cell_list":{"c1":{"location":[10,10,25,15],"region":"::A"}},"join_list":{}}`;
    const legacy = CdlDocumentLoader.loadSingle(flat, "main.cde");
    expect(legacy.document.getCell(asCellId("c1"))?.regionId).toBe("::A");
    const saved = CdlSerializer.serialize(legacy.document);
    expect(CdlDocumentLoader.loadSingle(saved, "main.cde").document.getCell(asCellId("c1"))?.regionId).toBe("::A");

    const referenceOnly = CdlDocumentLoader.loadSources([
      { text: "region Shared {};", fileName: "shared.cdl", editable: false },
      { text: flat.replace("region A {};", "").replace('"::A"', '"::Shared"'), fileName: "main.cde", editable: true },
    ]);
    expect(referenceOnly.document.getCell(asCellId("c1"))?.regionId).toBe("::");
    expect(referenceOnly.diagnostics.some((d) => d.code === "W-REGION-MISMATCH")).toBe(true);
  });
});

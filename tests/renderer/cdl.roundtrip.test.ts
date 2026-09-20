// TECSCDE-TS内部仕様 11.3 — 最初の実装単位: モデル＋CDLパーサ/シリアライザのround trip検証。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { CdlGrammar } from "../../src/renderer/cdl/grammar";

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

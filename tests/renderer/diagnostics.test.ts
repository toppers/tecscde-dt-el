// [[TECSCDE-DT-EL内部仕様]] 第8章（整合性チェックとメッセージ設計）— モジュールH の
// ヘッドレステスト。`DiagnosticsCollector` の集約、`DiagnosticReport` の不変スナップショット、
// `checkIntegrity` の再導出。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { W_CODES } from "../../src/renderer/cdl/messages";
import {
  DiagnosticReport,
  DiagnosticsCollector,
  checkIntegrity,
  type Diagnostic,
} from "../../src/renderer/diagnostics";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

const err = (code: string): Diagnostic => ({ severity: "error", code, message: code });
const warn = (code: string): Diagnostic => ({ severity: "warning", code, message: code });

describe("DiagnosticsCollector", () => {
  it("accumulates via report / reportAll and resets on clear", () => {
    const c = new DiagnosticsCollector();
    c.report(warn("W-1"));
    c.reportAll([warn("W-2"), err("E-1")]);
    expect(c.size).toBe(3);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.toReport().isEmpty).toBe(true);
  });

  it("toReport returns an immutable snapshot decoupled from later reports", () => {
    const c = new DiagnosticsCollector();
    c.report(warn("W-1"));
    const snapshot = c.toReport();
    c.report(err("E-1"));
    expect(snapshot.items).toHaveLength(1);
    expect(c.toReport().items).toHaveLength(2);
  });
});

describe("DiagnosticReport", () => {
  it("sorts errors before warnings, stable within a severity", () => {
    const r = new DiagnosticReport([warn("W-a"), err("E-a"), warn("W-b"), err("E-b")]);
    expect(r.items.map((d) => d.code)).toEqual(["E-a", "E-b", "W-a", "W-b"]);
  });

  it("counts by severity and reports emptiness", () => {
    const r = new DiagnosticReport([err("E-1"), warn("W-1"), warn("W-2")]);
    expect(r.errorCount).toBe(1);
    expect(r.warningCount).toBe(2);
    expect(r.isEmpty).toBe(false);
    expect(DiagnosticReport.empty().isEmpty).toBe(true);
  });
});

describe("checkIntegrity", () => {
  it("flags an unresolved celltype and an unresolved direct_import reference file", () => {
    const text = [
      "cell tUndefinedType cFoo {",
      "}",
      "",
      '__tool_info__("tecsgen") {',
      '  "direct_import": ["missing.cdl"]',
      "}",
      "",
    ].join("\n");

    const { document } = CdlDocumentLoader.loadSingle(text, "test.cde");
    const codes = checkIntegrity(document)
      .map((d) => d.code)
      .sort();
    expect(codes).toEqual([W_CODES.UNRESOLVED_CELLTYPE, W_CODES.UNRESOLVED_REF_FILE].sort());
  });

  it("returns nothing for the clean sample fixture", () => {
    const { document } = CdlDocumentLoader.loadSources([
      { text: celltypesText, fileName: "celltypes.cdl", editable: false },
      { text: mainText, fileName: "main.cde", editable: true },
    ]);
    expect(checkIntegrity(document)).toEqual([]);
  });
});

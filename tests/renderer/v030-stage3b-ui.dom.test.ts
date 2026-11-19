/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { PaperSpec } from "../../src/renderer/model/paper";
import { AppStore } from "../../src/renderer/app/store";
import { newDocument } from "../../src/renderer/app/file-actions";
import { DiagnosticsPanelView } from "../../src/renderer/app/diagnostics-panel";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

describe("V0.3.0 Stage 3B — 2-1 & 2-9: panel-visibility menu removed", () => {
  it("removes #panel-visibility from index.html so toolbar, property panel, and statusbar stay visible", () => {
    const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf-8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelector("#panel-visibility")).toBeNull();
    expect(parsed.querySelector("[data-panel='toolbar']")).toBeNull();
    expect(parsed.querySelector("#toolbar")).not.toBeNull();
    expect(parsed.querySelector("#property-panel")).not.toBeNull();
    expect(parsed.querySelector("#statusbar")).not.toBeNull();
  });
});

describe("V0.3.0 Stage 3B — 2-8: mode switcher in toolbar", () => {
  it("provides #toolbar-mode select and newCell buttons directly in index.html toolbar", () => {
    const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf-8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const selectBtn = parsed.querySelector("#toolbar #toolbar-mode button[data-mode='select']");
    const newCellBtn = parsed.querySelector("#toolbar #toolbar-mode button[data-mode='newCell']");
    expect(selectBtn?.textContent).toBe("選択");
    expect(newCellBtn?.textContent).toBe("セル新規作成");
  });
});

describe("V0.3.0 Stage 3B — 2-7: application default paper for newDocument", () => {
  it("uses store.getDefaultPaper() when creating a new document", async () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask { entry sSig e; };
      cell tTask c1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const store = new AppStore(doc);
    store.setDefaultPaper(PaperSpec.create("A3", "PORTRAIT"));

    const gateway: Partial<FileGateway> = {
      confirmDiscardChanges: vi.fn(async () => true),
      saveSession: vi.fn(async () => {}),
    };
    await newDocument(store, gateway as FileGateway);

    expect(store.getDocument().paper.size).toBe("A3");
    expect(store.getDocument().paper.orientation).toBe("PORTRAIT");
  });
});

describe("V0.3.0 Stage 3B — 2-19: DiagnosticsPanelView 4-column table", () => {
  it("renders diagnostics in a 4-column table (種別, 該当箇所, メッセージ, 操作) with jump buttons", () => {
    const cdl = `
      signature sSig { void f(); };
      celltype tTask { entry sSig e; };
      cell tTask c1 {};
    `;
    const { document: doc } = CdlDocumentLoader.loadSingle(cdl, "main.cdl");
    const cellId = doc.cellValues()[0]!.id;
    const store = new AppStore(doc, [
      { severity: "warning", code: "W-TEST-1", message: "セルの警告", relatedCellId: cellId },
      { severity: "error", code: "E-TEST-2", message: "構文エラー", location: { file: "a.cdl", line: 12, column: 4 } },
    ]);

    const toggleEl = document.createElement("button");
    const panelEl = document.createElement("div");
    const view = new DiagnosticsPanelView(toggleEl, panelEl, store);
    view.render();

    const headers = Array.from(panelEl.querySelectorAll("table.diag-table thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["種別", "該当箇所", "メッセージ", "操作"]);

    // DiagnosticsCollector はエラー先・警告後の順で並べる
    const rows = Array.from(panelEl.querySelectorAll("tbody tr.diag-item"));
    expect(rows).toHaveLength(2);

    const cells0 = Array.from(rows[0]!.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells0[0]).toContain("エラー");
    expect(cells0[1]).toBe("a.cdl:12:4");
    expect(cells0[2]).toBe("構文エラー");
    expect(rows[0]!.querySelector("button.diag-jump-btn")).toBeNull();

    const cells1 = Array.from(rows[1]!.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells1[0]).toContain("警告");
    expect(cells1[1]).toBe(String(cellId));
    expect(cells1[2]).toBe("セルの警告");
    expect(rows[1]!.querySelector("button.diag-jump-btn")?.textContent).toBe("ジャンプ");
  });
});

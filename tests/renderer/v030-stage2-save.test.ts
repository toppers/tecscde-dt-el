import { describe, expect, it, vi } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { ToolInfoValidator } from "../../src/renderer/cdl/tool-info";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { AppStore } from "../../src/renderer/app/store";
import { newDocument, save } from "../../src/renderer/app/file-actions";
import { AddCellCommand, MoveCellCommand } from "../../src/renderer/commands/cell-commands";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

const BASE_DEFS = `
signature sSig {
  void func(void);
};
celltype tClient {
  call sSig cCall;
};
celltype tServer {
  entry sSig eEntry;
};
`;

describe("V0.3.0 Stage 2 — 4-2: save with unconfirmed primary and dirty reference CDL", () => {
  it("saves dirty reference CDL without prompting Save As when primary has no unsaved changes", async () => {
    const refPath = "C:\\proj\\ref.cdl";
    const refContent = `${BASE_DEFS}\ncell tServer cRef {};\n`;
    const mainPath = "C:\\proj\\main.cdl";
    const mainContent = `cell tClient cMain { cCall = cRef.eEntry; };\n`;

    const loaded = CdlDocumentLoader.loadSources([
      { fileName: "ref.cdl", sourcePath: refPath, text: refContent, editable: true },
      { fileName: "main.cdl", sourcePath: mainPath, text: mainContent, editable: true },
    ], { primarySourceKey: mainPath });

    const store = new AppStore(loaded.document);
    store.loadDocument(loaded.document, mainPath, [], [refPath], new Map([[refPath, refContent]]));

    const savedCalls: Array<{ path: string; content: string }> = [];
    const gateway: Partial<FileGateway> = {
      confirmDiscardChanges: vi.fn(async () => true),
      saveSession: vi.fn(async () => {}),
      save: vi.fn(async (path: string, content: string) => {
        savedCalls.push({ path, content });
        return { path, writeSequence: 1 };
      }),
      chooseSavePath: vi.fn(async () => "C:\\proj\\should-not-be-called.cde"),
      saveAs: vi.fn(async () => "C:\\proj\\should-not-be-called.cde"),
    };

    // 消去で主ファイル未確定（filePath = null）にし、参照 CDL のセルだけ編集する
    await newDocument(store, gateway as FileGateway);
    expect(store.filePath).toBeNull();
    const refCell = store.getDocument().cellValues().find((c) => c.name === "cRef")!;
    store.dispatch(new MoveCellCommand(refCell.id, refCell.x + 10, refCell.y + 10));
    expect(store.isSourceDirty(refPath)).toBe(true);
    expect(store.isSourceDirty(null)).toBe(false);

    await save(store, gateway as FileGateway);

    expect(savedCalls.map((c) => c.path)).toEqual([refPath]);
    expect(gateway.chooseSavePath).not.toHaveBeenCalled();
    expect(gateway.saveAs).not.toHaveBeenCalled();
    expect(store.isSourceDirty(refPath)).toBe(false);
  });

  it("saves dirty reference CDL even if the user cancels Save As for a dirty unconfirmed primary", async () => {
    const refPath = "C:\\proj\\ref.cdl";
    const refContent = `${BASE_DEFS}\ncell tServer cRef {};\n`;
    const mainPath = "C:\\proj\\main.cdl";
    const mainContent = `cell tClient cMain {};\n`;

    const loaded = CdlDocumentLoader.loadSources([
      { fileName: "ref.cdl", sourcePath: refPath, text: refContent, editable: true },
      { fileName: "main.cdl", sourcePath: mainPath, text: mainContent, editable: true },
    ], { primarySourceKey: mainPath });

    const store = new AppStore(loaded.document);
    store.loadDocument(loaded.document, mainPath, [], [refPath], new Map([[refPath, refContent]]));

    const savedCalls: string[] = [];
    const gateway: Partial<FileGateway> = {
      confirmDiscardChanges: vi.fn(async () => true),
      saveSession: vi.fn(async () => {}),
      save: vi.fn(async (path: string) => {
        savedCalls.push(path);
        return { path, writeSequence: 1 };
      }),
      chooseSavePath: vi.fn(async () => null), // 主ファイルのダイアログをキャンセル
    };

    await newDocument(store, gateway as FileGateway);

    // 参照セル移動 + 主ドキュメントへ新規セル追加（両方 dirty）
    const refCell = store.getDocument().cellValues().find((c) => c.name === "cRef")!;
    store.dispatch(new MoveCellCommand(refCell.id, refCell.x + 5, refCell.y + 5));
    store.dispatch(new AddCellCommand("tClient", 20, 20));
    expect(store.isSourceDirty(refPath)).toBe(true);
    expect(store.isSourceDirty(null)).toBe(true);

    await save(store, gateway as FileGateway);

    expect(savedCalls).toEqual([refPath]);
    expect(gateway.chooseSavePath).toHaveBeenCalledOnce();
    expect(store.isSourceDirty(refPath)).toBe(false);
    expect(store.isSourceDirty(null)).toBe(true);
  });
});

describe("V0.3.0 Stage 2 — 4-5: primary serialization source filtering and joinList ownership", () => {
  it("excludes reference-owned cells and reference-owned joins from primary serialize()", () => {
    const refPath = "C:\\proj\\ref.cdl";
    const mainPath = "C:\\proj\\main.cdl";
    const refContent = `${BASE_DEFS}
cell tServer cSrv {};
cell tClient cRefClient {
  cCall = cSrv.eEntry;
};
`;
    const mainContent = `
cell tClient cMainClient {
  cCall = cSrv.eEntry;
};
`;
    const loaded = CdlDocumentLoader.loadSources([
      { fileName: "ref.cdl", sourcePath: refPath, text: refContent, editable: true },
      { fileName: "main.cdl", sourcePath: mainPath, text: mainContent, editable: true },
    ], { primarySourceKey: mainPath });

    const serialized = CdlSerializer.serialize(loaded.document);
    const tecscdeBlock = ToolInfoValidator.extractBlocks(serialized).blocks.find((b) => b.toolName === "tecscde")!;
    const { parsed } = ToolInfoValidator.parseTecscde(tecscdeBlock.json);

    // 主ファイルの cell_list / join_list には cMainClient 由来だけが含まれ、cRefClient 由来は含まれない
    expect(Object.keys(parsed.cellList)).toEqual(["cMainClient"]);
    const joinCells = Object.values(parsed.joinList).map((j) => j.cell);
    expect(joinCells).toEqual(["cMainClient"]);
    expect(serialized).not.toContain("cell tClient cRefClient");
  });

  it("does not leak foreign-locale cells into primary serialize() even when sourceTemplates.size <= 1", () => {
    const refPath = "C:\\proj\\ref.cdl";
    const mainPath = "C:\\proj\\main.cdl";
    const refContent = `${BASE_DEFS}\ncell tServer cForeign {};\n`;
    const mainContent = `cell tClient cMain {};\n`;

    const loaded = CdlDocumentLoader.loadSources([
      { fileName: "ref.cdl", sourcePath: refPath, text: refContent, editable: true },
      { fileName: "main.cdl", sourcePath: mainPath, text: mainContent, editable: true },
    ], { primarySourceKey: mainPath });

    // sourceTemplates が 1 件以下になった状態を再現（例: 参照テンプレート無しで他ソースセルが存在）
    const singleTemplateMap = new Map(
      [...loaded.document.sourceTemplates.entries()].filter(([k]) => k === mainPath),
    );
    const doc = loaded.document;
    const docWithSingleTemplate = TecscdeDocument.build({
      cells: new Map(doc.cellValues().map((c) => [c.id, c])),
      joins: new Map(doc.joinValues().map((j) => [j.id, j])),
      celltypes: new Map(doc.celltypeValues().map((t) => [t.name, t])),
      regions: doc.regions,
      toolInfoTecsgen: doc.toolInfoTecsgen,
      paper: doc.paper,
      referenceFiles: doc.referenceFiles,
      primarySourceKey: doc.primarySourceKey,
      editingFileName: doc.editingFileName,
      sourceOrder: doc.sourceOrder,
      sourceTemplate: doc.sourceTemplate,
      sourceTemplates: singleTemplateMap,
      preservedImports: doc.preservedImports,
      unknownToolInfoTecscde: doc.unknownToolInfoTecscde,
    });
    expect(docWithSingleTemplate.sourceTemplates.size).toBe(1);

    const serialized = CdlSerializer.serialize(docWithSingleTemplate);
    expect(serialized).toContain("cell tClient cMain");
    expect(serialized).not.toContain("cell tServer cForeign");
  });
});

describe("V0.3.0 Stage 2 — 4-6: preserve nested unknown keys in cell_list / ports / join_list / bars", () => {
  it("preserves unknown keys inside cell_list, ports, join_list, and bars on round-trip serialize()", () => {
    const mainPath = "C:\\proj\\main.cdl";
    const source = `${BASE_DEFS}
cell tServer cSrv {};
cell tClient cCli {
  cCall = cSrv.eEntry;
};
__tool_info__("tecscde") {
  "paper": { "size": "A4", "orientation": "LANDSCAPE" },
  "custom_top": 42,
  "cell_list": {
    "cCli": {
      "location": [10, 10, 30, 20],
      "region": "::",
      "custom_cell_key": "keep-cell",
      "ports": {
        "cCall": { "edge": "RIGHT", "offset": 5, "custom_port_key": "keep-port" }
      }
    },
    "cSrv": {
      "location": [80, 10, 30, 20],
      "region": "::"
    }
  },
  "join_list": {
    "cCli.cCall": {
      "cell": "cCli",
      "cport": "cCall",
      "targetCell": "cSrv",
      "eport": "eEntry",
      "custom_join_key": "keep-join",
      "bars": [
        { "dir": "H", "fixed": 15, "from": 40, "to": 80, "custom_bar_key": "keep-bar" }
      ]
    }
  }
}
`;
    const loaded = CdlDocumentLoader.loadSources([
      { fileName: "main.cdl", sourcePath: mainPath, text: source, editable: true },
    ], { primarySourceKey: mainPath });

    const serialized = CdlSerializer.serialize(loaded.document);
    const tecscdeBlock = ToolInfoValidator.extractBlocks(serialized).blocks.find((b) => b.toolName === "tecscde")!;
    const raw = JSON.parse(tecscdeBlock.json) as Record<string, any>;

    expect(raw.custom_top).toBe(42);
    expect(raw.cell_list.cCli.custom_cell_key).toBe("keep-cell");
    expect(raw.cell_list.cCli.ports.cCall.custom_port_key).toBe("keep-port");
    expect(raw.join_list["cCli.cCall"].custom_join_key).toBe("keep-join");
    expect(raw.join_list["cCli.cCall"].bars[0].custom_bar_key).toBe("keep-bar");
  });
});

describe("V0.3.0 Stage 2 — 4-7: validate saved join_list bars conservatively", () => {
  const validHeader = { cell: "c1", cport: "cCall", targetCell: "c2", eport: "eEntry" };

  it("accepts valid single-bar and orthogonally connected multi-bar routes", () => {
    const json = JSON.stringify({
      paper: { size: "A4", orientation: "LANDSCAPE" },
      join_list: {
        single: { ...validHeader, bars: [{ dir: "H", fixed: 15, from: 40, to: 80 }] },
        multi: {
          ...validHeader,
          bars: [
            { dir: "H", fixed: 15, from: 40, to: 60 },
            { dir: "V", fixed: 60, from: 15, to: 35 },
            { dir: "H", fixed: 35, from: 60, to: 80 },
          ],
        },
      },
    });
    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(parsed.joinList)).toEqual(["single", "multi"]);
  });

  it("discards join routes with empty bars, invalid dir, non-finite numbers, or disconnected endpoints", () => {
    const json = JSON.stringify({
      paper: { size: "A4", orientation: "LANDSCAPE" },
      join_list: {
        empty: { ...validHeader, bars: [] },
        badItem: { ...validHeader, bars: ["not-an-object"] },
        badDir: { ...validHeader, bars: [{ dir: "D", fixed: 10, from: 0, to: 20 }] },
        nonNumber: { ...validHeader, bars: [{ dir: "H", fixed: "10", from: 0, to: 20 }] },
        disconnected: {
          ...validHeader,
          bars: [
            { dir: "H", fixed: 15, from: 40, to: 60 },
            { dir: "V", fixed: 75, from: 15, to: 35 }, // x=60 != x=75
          ],
        },
      },
    });
    const { parsed, diagnostics } = ToolInfoValidator.parseTecscde(json);
    expect(Object.keys(parsed.joinList)).toEqual([]);
    expect(diagnostics.length).toBe(5);
    expect(diagnostics.every((d) => d.code === W_CODES.LAYOUT_DISCARDED)).toBe(true);
  });
});

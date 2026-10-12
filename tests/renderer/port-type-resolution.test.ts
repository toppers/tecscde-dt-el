import { describe, expect, it, vi } from "vitest";
import { applyOpenResult, addAsReference } from "../../src/renderer/app/file-actions";
import { AppStore } from "../../src/renderer/app/store";
import { CdeclExtractor } from "../../src/renderer/cdecl/extractor";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { portTypeKey } from "../../src/renderer/cdl/port-type-index";
import { CreateJoinCommand } from "../../src/renderer/commands/join-commands";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";

const header = "typedef unsigned char Byte; struct Record { Byte value; };";
const cdeclResults = () => new Map([["/inc/types.h", CdeclExtractor.extract(header)]]);

describe("import_C port type resolution", () => {
  it("resolves imported typedef and struct types through a namespaced signature", () => {
    const text = `namespace n {
  signature sData { Byte get([in] struct Record *record); void reset(void); };
};
celltype tCall { call n::sData c; };
celltype tEntry { entry ::n::sData e; };
cell tCall Caller {};
cell tEntry Receiver {};
`;
    const { document, diagnostics, portTypeIndex } = CdlDocumentLoader.loadSingle(text, "main.cdl");
    // loadSingle is the no-import convenience API; the full loader receives the header results.
    expect(portTypeIndex.signatures.get("n::sData")?.valid).toBe(false);
    expect(diagnostics.some((item) => item.code === "W-C-TYPE-UNRESOLVED")).toBe(true);

    const loaded = CdlDocumentLoader.loadSources([{ text, fileName: "main.cdl", editable: true }], { cdeclResults: cdeclResults() });
    const signature = loaded.portTypeIndex.signatures.get("n::sData");
    expect(signature?.valid).toBe(true);
    expect(signature?.functions.map((fn) => fn.name)).toEqual(["get", "reset"]);
    expect(signature?.functions[0]?.returns.type).toEqual({ kind: "primitive", name: "char", spelling: "unsigned char" });
    expect(signature?.functions[0]?.parameters[0]?.type).toMatchObject({
      kind: "pointer", pointee: { kind: "struct", tag: "Record", members: [{ name: "value", type: { kind: "primitive", name: "char", spelling: "unsigned char" } }] },
    });
    expect(loaded.portTypeIndex.ports.get(portTypeKey("tCall", "call", "c"))).toEqual({ signatureId: "n::sData", valid: true });
    expect(loaded.document.getCell(asCellId("Caller"))?.cports[0]?.signature).toBe("::n::sData");
    expect(loaded.document.getCell(asCellId("Receiver"))?.eports[0]?.signature).toBe("::n::sData");
    expect(new CreateJoinCommand(asCellId("Caller"), "c", null, asCellId("Receiver"), "e").apply(loaded.document).joinCount).toBe(1);
    const saved = CdlSerializer.serialize(loaded.document);
    expect(saved).toContain("call n::sData c;");
    expect(saved).toContain("entry ::n::sData e;");
    expect(document.joinCount).toBe(0);
  });

  it("does not join equal short names from different namespaces", () => {
    const text = `namespace a { signature s { void run(void); }; };
namespace b { signature s { void run(void); }; };
celltype tCall { call a::s c; };
celltype tEntry { entry b::s e; };
cell tCall Caller {};
cell tEntry Receiver {};
`;
    const { document } = CdlDocumentLoader.loadSingle(text, "main.cdl");
    expect(document.getCell(asCellId("Caller"))?.cports[0]?.signature).toBe("::a::s");
    expect(document.getCell(asCellId("Receiver"))?.eports[0]?.signature).toBe("::b::s");
    expect(new CreateJoinCommand(asCellId("Caller"), "c", null, asCellId("Receiver"), "e").apply(document).joinCount).toBe(0);
  });

  it("keeps function pointer argument types in a CDL signature", () => {
    const { diagnostics, portTypeIndex } = CdlDocumentLoader.loadSingle(
      "signature s { void run([in] int (*callback)(char value)); };", "callback.cdl",
    );
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(portTypeIndex.signatures.get("s")?.functions[0]?.parameters[0]?.type).toMatchObject({
      kind: "pointer",
      pointee: { kind: "function", returns: { kind: "primitive", name: "int" }, parameters: [{ kind: "primitive", name: "char" }] },
    });
  });

  it("keeps ports visible and reports a conflicting imported typedef", () => {
    const results = new Map([
      ["/inc/a.h", CdeclExtractor.extract("typedef char Byte;")],
      ["/inc/b.h", CdeclExtractor.extract("typedef int Byte;")],
    ]);
    const text = "signature s { Byte get(void); }; celltype t { call s c; }; cell t C {};";
    const loaded = CdlDocumentLoader.loadSources([{ text, fileName: "main.cdl", editable: true }], { cdeclResults: results });
    expect(loaded.portTypeIndex.signatures.get("s")?.valid).toBe(false);
    expect(loaded.document.getCell(asCellId("C"))?.cports).toHaveLength(1);
    expect(loaded.diagnostics.find((item) => item.code === "W-C-TYPE-UNRESOLVED")?.message).toContain("/inc/b.h");
  });

  it("resolves a local CDL typedef and detects a typedef cycle", () => {
    const local = CdlDocumentLoader.loadSingle("typedef int Local; signature s { Local get(void); };", "local.cdl");
    expect(local.portTypeIndex.signatures.get("s")?.valid).toBe(true);

    const results = new Map([["/inc/cycle.h", {
      typedefs: new Map([["A", { kind: "defined" as const, name: "B" }], ["B", { kind: "defined" as const, name: "A" }]]),
      structs: new Map(), hasErrors: false, usedFallback: false,
    }]]);
    const cycle = CdlDocumentLoader.loadSources([
      { text: "signature s { A get(void); };", fileName: "cycle.cdl", editable: true },
    ], { cdeclResults: results });
    expect(cycle.portTypeIndex.signatures.get("s")?.valid).toBe(false);
    expect(cycle.diagnostics.some((item) => item.message.includes("循環"))).toBe(true);
  });

  it("keeps a usable declaration from a partially parsed fallback header", () => {
    const extracted = CdeclExtractor.extract("typedef int Good; struct Broken { int x");
    expect(extracted.hasErrors).toBe(true);
    const loaded = CdlDocumentLoader.loadSources([
      { text: "signature s { Good get(void); }; celltype t { entry s e; };", fileName: "main.cdl", editable: true },
    ], { cdeclResults: new Map([["/inc/types.h", { ...extracted, usedFallback: true }]]) });
    expect(loaded.portTypeIndex.signatures.get("s")?.valid).toBe(true);
    expect(loaded.portTypeIndex.signatures.get("s")?.functions[0]?.returns).toMatchObject({ fallback: true, origins: ["/inc/types.h"] });
    expect(loaded.diagnostics.filter((item) => item.code === "W-C-TYPE-UNRESOLVED")).toEqual([]);
  });

  it("uses headers imported by a manually added CDL and retains earlier header types", async () => {
    const files: Record<string, { canonicalPath: string; content: string }> = {
      "old.h": { canonicalPath: "/inc/old.h", content: "typedef int Old;" },
      "/extra.cdl": { canonicalPath: "/extra.cdl", content: 'import_C("new.h"); signature sNew { New get(void); };' },
      "new.h": { canonicalPath: "/inc/new.h", content: "typedef char New;" },
    };
    const gateway = {
      resolveImports: vi.fn(async (_path: string, requests: readonly { kind: string; specifier: string }[]) => requests.map((request) => {
        const file = files[request.specifier];
        return file ? { request, ...file } : { request, error: "not-found" };
      })),
      saveSession: vi.fn(async () => undefined),
    } as unknown as FileGateway;
    const tecsgen = {
      preprocess: vi.fn(async (path: string) => ({ stdout: path.includes("old") ? files["old.h"]!.content : files["new.h"]!.content, stderr: "", exitCode: 0, executableFound: true })),
    } as unknown as TecsgenGateway;
    const store = new AppStore();
    await applyOpenResult(store, gateway, tecsgen, {
      editable: { path: "/main.cdl", content: 'import_C("old.h"); signature sOld { Old get(void); }; celltype t { call sOld c; };' },
      references: [],
    });
    expect(store.getPortTypeIndex().signatures.get("sOld")?.valid).toBe(true);
    await addAsReference(store, gateway, tecsgen, "/extra.cdl");
    expect(store.getPortTypeIndex().signatures.get("sOld")?.valid).toBe(true);
    expect(store.getPortTypeIndex().signatures.get("sNew")?.valid).toBe(true);
    store.loadDocument(store.getDocument(), null);
    expect(store.getPortTypeIndex().signatures.size).toBe(0);
  });
});

// [[TECSCDE-DT-EL内部仕様]] 04B 4B.5・4B.10節 — celltype の `require` 文の扱い。
// 名前なしの require は図に出ない呼び口として数えて警告し、名前つきの require は
// 通常の呼び口（結合できる）としてモデルに加える。

import { describe, expect, it } from "vitest";
import { CdlDocumentBuilder } from "../../src/renderer/cdl/cst";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { W_CODES } from "../../src/renderer/cdl/messages";

const BASE = `
signature sSyscall {
  void func(void);
};

celltype tKernel {
  entry sSyscall eSc;
  entry sSyscall eSc2;
};

cell tKernel Kernel {
};
`;

function load(text: string) {
  return CdlDocumentLoader.loadSources([{ text: BASE + text, fileName: "t.cdl", editable: true }]);
}

describe("require (unnamed) — hidden call ports", () => {
  it("counts each unnamed require as a hidden port and warns once per cell", () => {
    const { diagnostics } = load(`
celltype tNeedsKernel {
  call sSyscall cOut;
  require tKernel.eSc;
  require Kernel.eSc2;
};
cell tNeedsKernel Needs1 {
  cOut = Kernel.eSc;
};
cell tNeedsKernel Needs2 {
  cOut = Kernel.eSc;
};
`);
    const hidden = diagnostics.filter((d) => d.code === W_CODES.REQUIRE_PORT_HIDDEN);
    expect(hidden).toHaveLength(2);
    expect(hidden[0]!.message).toContain("Needs1");
    expect(hidden[0]!.message).toContain("2 個");
  });

  it("does not add the hidden port to the cell or draw it", () => {
    const { document } = load(`
celltype tNeedsKernel {
  call sSyscall cOut;
  require tKernel.eSc;
};
cell tNeedsKernel Needs {
  cOut = Kernel.eSc;
};
`);
    const cell = document.cellValues().find((c) => c.name === "Needs")!;
    expect(cell.cports.map((p) => p.name)).toEqual(["cOut"]);
  });

  it("does not warn for a celltype without require", () => {
    const { diagnostics } = load(`
celltype tPlain {
  call sSyscall cOut;
};
cell tPlain Plain {
  cOut = Kernel.eSc;
};
`);
    expect(diagnostics.map((d) => d.code)).not.toContain(W_CODES.REQUIRE_PORT_HIDDEN);
  });
});

describe("require (named) — a real call port", () => {
  it("adds the named port with the signature of the required entry (owner is a cell)", () => {
    const { document, diagnostics } = load(`
celltype tNamed {
  call sSyscall cCall;
  require cReqCall = Kernel.eSc;
  entry sSyscall eSc;
};
cell tNamed Named {
  cCall = Kernel.eSc;
  cReqCall = Kernel.eSc2;
};
`);
    const cell = document.cellValues().find((c) => c.name === "Named")!;
    expect(cell.cports.map((p) => p.name).sort()).toEqual(["cCall", "cReqCall"]);
    expect(cell.cports.find((p) => p.name === "cReqCall")!.signature).toBe("::sSyscall");
    expect(document.joinValues().filter((j) => j.cellId === cell.id)).toHaveLength(2);
    const codes = diagnostics.map((d) => d.code);
    expect(codes).not.toContain(W_CODES.MISSING_JOIN_TARGET);
    expect(codes).not.toContain(W_CODES.PORT_SIGNATURE_UNRESOLVED);
    // 名前つきは隠れた呼び口ではないので、警告の対象にしない。
    expect(codes).not.toContain(W_CODES.REQUIRE_PORT_HIDDEN);
  });

  it("resolves the signature when the owner is a celltype name", () => {
    const { document, diagnostics } = load(`
celltype tNamed2 {
  require cReq = tKernel.eSc;
};
cell tNamed2 Named2 {
  cReq = Kernel.eSc;
};
`);
    const cell = document.cellValues().find((c) => c.name === "Named2")!;
    expect(cell.cports.find((p) => p.name === "cReq")!.signature).toBe("::sSyscall");
    expect(diagnostics.map((d) => d.code)).not.toContain(W_CODES.PORT_SIGNATURE_UNRESOLVED);
  });

  it("warns that the signature cannot be resolved when the required entry is unknown", () => {
    const { diagnostics } = load(`
celltype tBroken {
  require cReq = NoSuchOwner.eX;
};
cell tBroken Broken {
};
`);
    const warning = diagnostics.find((d) => d.code === W_CODES.PORT_SIGNATURE_UNRESOLVED);
    expect(warning?.message).toContain("NoSuchOwner.eX");
  });
});

describe("CdlDocumentBuilder.build — top level and nested scopes are walked alike", () => {
  const text = `
signature sTop { void f(void); };
celltype tTop { entry sTop eE; };
cell tTop cTop { };
namespace nsA {
  signature sIn { void g(void); };
  celltype tIn { entry sIn eE; };
  cell tIn cIn { };
};
`;

  it("collects top-level declarations without qualification", () => {
    const parsed = CdlDocumentBuilder.build(text);
    expect(parsed.signatures.map((s) => s.name)).toContain("sTop");
    expect(parsed.celltypes.find((c) => c.name === "tTop")!.qualifiedName).toBe("tTop");
    expect(parsed.cells.find((c) => c.cellName === "cTop")!.regionPath).toBe("::");
  });

  it("collects declarations inside a namespace with the namespace path", () => {
    const parsed = CdlDocumentBuilder.build(text);
    expect(parsed.signatures.map((s) => s.name)).toContain("nsA::sIn");
    expect(parsed.celltypes.find((c) => c.name === "tIn")!.qualifiedName).toBe("nsA::tIn");
    expect(parsed.cells.find((c) => c.cellName === "cIn")!.regionPath).toBe("::nsA");
    expect(parsed.scopes.map((s) => s.path)).toContain("::nsA");
  });
});

describe("W_CODES", () => {
  it("defines the loader's formerly inline codes in one place", () => {
    expect(W_CODES.C_TYPE_UNRESOLVED).toBe("W-C-TYPE-UNRESOLVED");
    expect(W_CODES.PORT_SIGNATURE_UNRESOLVED).toBe("W-PORT-SIGNATURE-UNRESOLVED");
    expect(W_CODES.REGION_MISMATCH).toBe("W-REGION-MISMATCH");
  });
});

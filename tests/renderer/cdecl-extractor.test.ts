// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] —
// CdeclExtractor.extract() のCST走査アルゴリズムを検証する。tree-sitter-tecs-cdecl文法
// 自体（130/130件のCヘッダで検証済み、README_ja.md）の正しさは前提とし、ここでは
// 抽出アルゴリズム（typedef/struct→CType/CStructDefへの組み立て）だけを対象にする。

import { describe, expect, it } from "vitest";
import { CdeclExtractor } from "../../src/renderer/cdecl/extractor";

describe("CdeclExtractor", () => {
  it("extracts a primitive typedef", () => {
    const { typedefs, hasErrors } = CdeclExtractor.extract("typedef unsigned char uint8_t;");
    expect(hasErrors).toBe(false);
    expect(typedefs.get("uint8_t")).toEqual({ kind: "primitive", name: "char" });
  });

  it("extracts a pointer typedef", () => {
    const { typedefs } = CdeclExtractor.extract("typedef void *VP_INT;");
    expect(typedefs.get("VP_INT")).toEqual({
      kind: "pointer",
      pointee: { kind: "primitive", name: "void" },
    });
  });

  it("extracts an array typedef with a constant size", () => {
    const { typedefs } = CdeclExtractor.extract("typedef int IntArray4[4];");
    expect(typedefs.get("IntArray4")).toMatchObject({
      kind: "array",
      element: { kind: "primitive", name: "int" },
    });
  });

  it("extracts a tagged struct declaration with members", () => {
    const { structs } = CdeclExtractor.extract("struct Point { int x; int y; };");
    expect(structs.get("Point")).toEqual({
      tag: "Point",
      members: [
        { name: "x", type: { kind: "primitive", name: "int" } },
        { name: "y", type: { kind: "primitive", name: "int" } },
      ],
    });
  });

  it("extracts a typedef of an anonymous struct, referring to a previously-defined type", () => {
    const { typedefs } = CdeclExtractor.extract("typedef struct { MyType *next; } Node;");
    const node = typedefs.get("Node");
    expect(node).toMatchObject({ kind: "struct" });
    if (node?.kind !== "struct") throw new Error("expected struct");
    expect(node.members).toEqual([
      { name: "next", type: { kind: "pointer", pointee: { kind: "defined", name: "MyType" } } },
    ]);
  });

  it("recognizes typedef/struct inside an extern \"C\" block", () => {
    const { typedefs, structs } = CdeclExtractor.extract(
      'extern "C" { typedef int MyInt; struct Tag { int f; }; }',
    );
    expect(typedefs.get("MyInt")).toEqual({ kind: "primitive", name: "int" });
    expect(structs.get("Tag")).toBeDefined();
  });

  it("skips function prototypes, extern variables, and preprocessor directives (only typedef/struct reach the parser)", () => {
    const { typedefs, structs, hasErrors } = CdeclExtractor.extract(
      "#include <stdio.h>\nextern int g_counter;\nvoid foo(int a, int b);\ntypedef long MyLong;\n",
    );
    expect(hasErrors).toBe(false);
    expect(typedefs.size).toBe(1);
    expect(typedefs.get("MyLong")).toEqual({ kind: "primitive", name: "long" });
    expect(structs.size).toBe(0);
  });

  it("does not register an anonymous (untagged) struct declaration in the structs registry", () => {
    const { structs } = CdeclExtractor.extract("struct { int x; };");
    expect(structs.size).toBe(0);
  });

  it("reports hasErrors for malformed input while still extracting what it can (best-effort, 9B.5)", () => {
    const { typedefs, hasErrors } = CdeclExtractor.extract("typedef int MyInt; struct Broken { int x");
    expect(hasErrors).toBe(true);
    expect(typedefs.get("MyInt")).toEqual({ kind: "primitive", name: "int" });
  });
});

import { expect, it } from "vitest";
import { CdeclExtractor } from "../../src/renderer/cdecl/extractor";

it("preserves C function pointer parameter types", () => {
  const { typedefs } = CdeclExtractor.extract("typedef int (*Callback)(char value);");
  expect(typedefs.get("Callback")).toEqual({
    kind: "pointer",
    pointee: { kind: "function", returns: { kind: "primitive", name: "int" }, parameters: [{ kind: "primitive", name: "char" }] },
  });
});

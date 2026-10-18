import type { Node } from "web-tree-sitter";
import type { CType } from "../cdecl/types";

export interface TypeUse {
  readonly type?: CType;
  readonly line: number;
  readonly column: number;
}

export interface SignatureFunctionDecl {
  readonly name: string;
  readonly returns: TypeUse;
  readonly parameters: readonly TypeUse[];
}

export interface LocalTypedefDecl {
  readonly name: string;
  readonly type: CType;
}

function use(node: Node | null, type: CType | undefined): TypeUse {
  return { type, line: (node?.startPosition.row ?? 0) + 1, column: (node?.startPosition.column ?? 0) + 1 };
}

function primitive(name: string): CType | undefined {
  const normalized = name.trim().split(/\s+/).pop() ?? "";
  // CDL keywords have their own type identity even when C headers also define them.
  const names = [
    "void", "char", "short", "int", "long", "int64", "float", "double", "bool",
    "bool_t", "char_t", "schar_t", "uchar_t",
    "int8_t", "int16_t", "int32_t", "int64_t", "int128_t",
    "uint8_t", "uint16_t", "uint32_t", "uint64_t", "uint128_t",
    "float32_t", "double64_t",
  ];
  if (names.includes(normalized)) return {
    kind: "primitive", name: normalized as Extract<CType, { kind: "primitive" }>["name"],
    ...(name.trim() === normalized ? {} : { spelling: name.trim() }),
  };
  return normalized ? { kind: "defined", name: normalized } : undefined;
}

/** Read a type from the grammar's type nodes, not from declaration text. */
export function baseType(node: Node | null): CType | undefined {
  if (!node) return undefined;
  if (node.type === "declaration_specifiers") {
    for (const child of node.namedChildren) {
      if (!child || child.type === "type_qualifier" || child.type === "storage_class") continue;
      const found = baseType(child);
      if (found) return found;
    }
    return undefined;
  }
  if (node.type === "struct_specifier") {
    const tag = node.childForFieldName("name")?.text;
    return tag ? { kind: "struct", tag } : undefined;
  }
  if (node.type === "type_specifier" || node.type === "sign_int_type") {
    if (node.type === "sign_int_type") return primitive(node.text);
    return baseType(node.namedChildren.find((child) => child?.type !== "type_qualifier") ?? null) ?? primitive(node.text);
  }
  if (node.type === "primitive_type" || node.type === "int_type" || node.type === "char_type" || node.type === "identifier" || node.type === "type_specifier_or_identifier") {
    return primitive(node.text);
  }
  return undefined;
}

function pointerDepth(node: Node | null): number {
  if (!node) return 0;
  return 1 + pointerDepth(node.namedChildren.find((child) => child?.type === "pointer") ?? null);
}

function applyDeclarator(node: Node | null, base: CType): { name?: string; type: CType } {
  if (!node) return { type: base };
  if (node.type === "identifier") return { name: node.text, type: base };
  if (node.type === "declarator") {
    let type = base;
    for (let i = 0; i < pointerDepth(node.childForFieldName("pointer")); i += 1) {
      type = { kind: "pointer", pointee: type };
    }
    const inner = node.namedChildren.find((child) => child && child.type !== "pointer");
    return applyDeclarator(inner ?? null, type);
  }
  if (node.type === "array_declarator") {
    const size = node.childForFieldName("size")?.text;
    return applyDeclarator(node.childForFieldName("declarator"), { kind: "array", element: base, size });
  }
  if (node.type === "function_declarator") {
    const inner = node.namedChildren.find((child) => child && child.type !== "parameter_type_list");
    return applyDeclarator(inner ?? null, {
      kind: "function", returns: base,
      parameters: parameters(node).map((parameter) => parameter.type ?? { kind: "unsupported", name: "関数引数" }),
    });
  }
  return { type: base };
}

function functionDeclarator(node: Node | null): Node | undefined {
  if (!node) return undefined;
  if (node.type === "function_declarator") return node;
  for (const child of node.namedChildren) {
    const found = functionDeclarator(child);
    if (found) return found;
  }
  return undefined;
}

function parameters(node: Node): readonly TypeUse[] {
  const list = node.childForFieldName("parameters");
  if (!list) return [];
  return list.namedChildren.filter((child): child is Node => child?.type === "parameter_declaration").map((parameter) => {
    const base = baseType(parameter.childForFieldName("type"));
    return use(parameter, base ? applyDeclarator(parameter.childForFieldName("declarator"), base).type : undefined);
  });
}

export function signatureFunctions(signature: Node): readonly SignatureFunctionDecl[] {
  const functions: SignatureFunctionDecl[] = [];
  for (const head of signature.childrenForFieldName("body")) {
    if (!head || head.type !== "function_head") continue;
    const declaration = head.childForFieldName("declarator");
    const fn = functionDeclarator(declaration);
    const name = fn?.childForFieldName("declarator")?.text;
    if (!fn || !name) continue;
    const base = baseType(head.childrenForFieldName("type").find(Boolean) ?? null);
    const returns = use(head, base ? applyDeclarator(declaration, base).type : undefined);
    // The outer function declarator is the method itself, not its return type.
    const returnType = returns.type?.kind === "function" ? returns.type.returns : returns.type;
    functions.push({ name, returns: { ...returns, type: returnType }, parameters: parameters(fn) });
  }
  return functions;
}

export function localTypedefs(node: Node): readonly LocalTypedefDecl[] {
  const base = baseType(node.childrenForFieldName("type").find(Boolean) ?? null);
  const declarators = node.childForFieldName("declarator");
  if (!base || !declarators) return [];
  const result: LocalTypedefDecl[] = [];
  for (const declarator of declarators.namedChildren) {
    if (!declarator) continue;
    const resolved = applyDeclarator(declarator, base);
    if (resolved.name) result.push({ name: resolved.name, type: resolved.type });
  }
  return result;
}

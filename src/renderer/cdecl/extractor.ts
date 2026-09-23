// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] 9B.5 —
// tree-sitter-tecs-cdecl文法のCSTから typedef/struct を抽出する。ノード種別・フィールド名は
// tree-sitter-tecs-cdecl の node-types.json（2026-09-23確認）に基づく。
//
// 実装時の設計からの差分（09B.5案からの調整）: CdlDocumentBuilder.build(text) と同じ
// 慣習に合わせ、Tree を受け取るのではなくテキストを受け取り内部で CdeclGrammar.parserInstance
// を使ってparseする。診断（Diagnostic、ヘッダファイルパスを要する）は本モジュールでは
// 構築せず、パースエラーの有無だけを hasErrors として返す——ヘッダパスを知っているのは
// 呼び出し側（import-resolution.ts）であり、Diagnostic生成はそちら（cdl/messages.ts）に委ねる。

import type { Node as SyntaxNode } from "web-tree-sitter";
import { CdeclGrammar } from "./grammar";
import type { CType, CStructDef, CStructMember } from "./types";

export interface CdeclResult {
  readonly typedefs: ReadonlyMap<string, CType>;
  readonly structs: ReadonlyMap<string, CStructDef>;
  /** ERROR/MISSINGノードが残っていたか。走査自体は継続し、捕捉できた範囲は返す（9B.5）。 */
  readonly hasErrors: boolean;
}

export class CdeclExtractor {
  static extract(text: string): CdeclResult {
    const tree = CdeclGrammar.parserInstance.parse(text);
    const typedefs = new Map<string, CType>();
    const structs = new Map<string, CStructDef>();
    let hasErrors = false;

    if (!tree) {
      return { typedefs, structs, hasErrors: true };
    }

    // トップレベル限定ではなく全ノードを再帰的に走査する。文法側が
    // extern "C" { ... } の波括弧内部でも typedef_declaration / struct_declaration
    // を認識するよう既に作られているため（tree-sitter-tecs-cdecl README_ja.md
    // 「_balanced_braces」節）、ここで波括弧の深さを追跡する必要はない。
    walk(tree.rootNode, (node) => {
      if (node.type === "ERROR" || node.isMissing) {
        hasErrors = true;
      } else if (node.type === "typedef_declaration") {
        extractTypedef(node, typedefs);
      } else if (node.type === "struct_declaration") {
        extractStructDeclaration(node, structs);
      }
    });

    return { typedefs, structs, hasErrors };
  }
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    if (child) walk(child, visit);
  }
}

function extractTypedef(node: SyntaxNode, out: Map<string, CType>): void {
  // fields: type（enum_specifier|primitive_type|struct_specifier|type_qualifier|
  //   type_specifier_or_identifier|typeof_typeの並び、複数可）、declarator（declarator_list、必須）
  const typeNodes = node.childrenForFieldName("type");
  const baseType = resolveDeclarationSpecifiers(typeNodes);
  const declaratorList = node.childForFieldName("declarator");
  if (!declaratorList) return;

  for (const declarator of declaratorList.namedChildren) {
    if (!declarator) continue;
    const { name, type } = resolveDeclarator(declarator, baseType);
    if (name) out.set(name, type);
  }
}

function extractStructDeclaration(node: SyntaxNode, out: Map<string, CStructDef>): void {
  // struct_declaration → struct_specifier（fields: name=struct_tag, body=struct_declaration_list）
  const specifier = node.namedChildren.find((c) => c?.type === "struct_specifier");
  if (!specifier) return;
  const { tag, members } = resolveStructSpecifierMembers(specifier);
  // タグ無し（無名struct）は再参照する手段がタグ以外に無いため registry には載せない。
  if (tag) out.set(tag, { tag, members: members ?? [] });
}

/** struct_specifier からタグ（あれば）とメンバー一覧を取り出す。`body`（`{ ... }`）が
 *  無い場合（タグのみの参照、例: 他メンバーの型として使われる`struct Point`）は
 *  membersを`undefined`にする——空のstruct定義（`struct Foo {};`）と区別する（9B.4）。
 *  タグの有無に関わらずmembersは返す——CType.struct（9B.4）は無名structでもmembers付きの
 *  型として使う（例: `typedef struct { ... } Name;`）。 */
function resolveStructSpecifierMembers(specifier: SyntaxNode): { tag?: string; members?: readonly CStructMember[] } {
  const tagNode = specifier.childForFieldName("name"); // struct_tag（IDENTIFIER 1個）
  const bodyNode = specifier.childForFieldName("body"); // struct_declaration_list
  return { tag: tagNode?.text, members: bodyNode ? resolveStructBody(bodyNode) : undefined };
}

function resolveStructBody(bodyNode: SyntaxNode): readonly CStructMember[] {
  const members: CStructMember[] = [];
  for (const memberDecl of bodyNode.namedChildren) {
    // struct_member_declaration: fields type（declaration_specifiers）, declarator（struct_declarator_list）
    if (!memberDecl || memberDecl.type !== "struct_member_declaration") continue;
    const typeNode = memberDecl.childForFieldName("type");
    const baseType = typeNode ? resolveDeclarationSpecifiers(typeNode.namedChildren) : voidType();
    const declaratorList = memberDecl.childForFieldName("declarator"); // struct_declarator_list
    if (!declaratorList) continue;
    for (const structDeclarator of declaratorList.namedChildren) {
      // struct_declarator: 実際の文法ではbitfield無しの場合`declarator`フィールド名が
      // 付与されない（node-types.jsonの`fields.declarator`は`required: false`——実測で
      // childForFieldName("declarator")がnullを返すことを2026-09-23確認）。フィールド名に
      // 頼らず、"declarator"型のnamed childを直接探す（bitfield式は別ノード種別のため
      // 誤って拾わない）。
      const declaratorNode = structDeclarator?.namedChildren.find((c) => c?.type === "declarator");
      if (!declaratorNode) continue;
      const { name, type } = resolveDeclarator(declaratorNode, baseType);
      if (name) members.push({ name, type });
    }
  }
  return members;
}

/** declaration_specifiers（複数ノードの並び）を1つのCTypeへ畳み込む。Ruby版の
 *  declaration_specifiersのchained-merge（storage class無視・type_specifier/
 *  type_qualifierの積み重ね）に対応。最初に意味のある型指定子を採用する。 */
function resolveDeclarationSpecifiers(nodes: readonly (SyntaxNode | null)[]): CType {
  for (const node of nodes) {
    if (!node) continue;
    switch (node.type) {
      case "primitive_type":
        return { kind: "primitive", name: mapPrimitiveName(node.text) };
      case "struct_specifier": {
        const { tag, members } = resolveStructSpecifierMembers(node);
        return { kind: "struct", tag, members };
      }
      case "type_specifier_or_identifier":
        return { kind: "defined", name: node.text };
      case "type_qualifier": // const/volatile — 型の形には影響しないため無視（Ruby版もqualifierは形に含めない）
      case "storage_class": // extern/static等 — 無視（Ruby版と同じ）
        continue;
      case "enum_specifier": // 単独では到達不可（文法がenum単独をトリガーしない）。typedef対象にはなり得る
      case "typeof_type":
      case "union_specifier":
        return voidType(); // Ruby版もenum/unionは「voidが宣言されたとする」扱い（C_parser.y.rb）
      default:
        continue;
    }
  }
  return voidType();
}

/** declarator（再帰的なpointer/array_declarator/function_declarator/identifierの入れ子）を
 *  名前とCTypeへ分解する。Ruby版のポインタ・配列・関数ポインタ修飾の組み立てに対応。 */
function resolveDeclarator(node: SyntaxNode, baseType: CType): { name?: string; type: CType } {
  if (node.type === "identifier") {
    return { name: node.text, type: baseType };
  }
  if (node.type === "array_declarator") {
    const inner = node.childForFieldName("declarator");
    const sizeNode = node.childForFieldName("size");
    const arrayType: CType = { kind: "array", element: baseType, size: sizeNode?.text };
    return inner ? resolveDeclarator(inner, arrayType) : { type: arrayType };
  }
  if (node.type === "function_declarator") {
    const inner = node.childForFieldName("declarator");
    const funcType: CType = { kind: "function", returns: baseType };
    return inner ? resolveDeclarator(inner, funcType) : { type: funcType };
  }
  if (node.type === "declarator") {
    const pointerNode = node.childForFieldName("pointer");
    const innerType = pointerNode ? resolvePointer(pointerNode, baseType) : baseType;
    const inner = node.namedChildren.find(
      (c) => c !== null && ["array_declarator", "declarator", "function_declarator", "identifier"].includes(c.type),
    );
    return inner ? resolveDeclarator(inner, innerType) : { type: innerType };
  }
  return { type: baseType };
}

/** pointer（再帰的な入れ子で多重ポインタを表現）を CType.pointer の連鎖へ変換する。 */
function resolvePointer(node: SyntaxNode, pointeeType: CType): CType {
  const nestedPointer = node.namedChildren.find((c) => c?.type === "pointer");
  const inner: CType = nestedPointer ? resolvePointer(nestedPointer, pointeeType) : pointeeType;
  return { kind: "pointer", pointee: inner };
}

function mapPrimitiveName(text: string): Extract<CType, { kind: "primitive" }>["name"] {
  // primitive_typeのテキストは "unsigned long" 等、複数トークンを含み得る（declaration_specifiersの
  // 畳み込みでは1個目の primitive_type しか見ないため、"unsigned"/"signed"/"const" 等の修飾語は現状は
  // 落ちる——符号・幅の精密な再現は9B.2の範囲外（ポート型解決という実利用がまだ無いため）。
  const normalized = text.trim().split(/\s+/).pop() ?? "int";
  const known = ["void", "char", "short", "int", "long", "int64", "float", "double", "bool"] as const;
  return (known as readonly string[]).includes(normalized) ? (normalized as (typeof known)[number]) : "int";
}

function voidType(): CType {
  return { kind: "primitive", name: "void" };
}

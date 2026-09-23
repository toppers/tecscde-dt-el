// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] 9B.4 —
// Ruby版（tecslib/core/C_parser.y.rb）の型クラス（CIntType/CFloatType/CBoolType/
// CVoidType/CPtrType/CArrayType/CFuncType/CStructType/CDefinedType）を、判別ユニオン
// 1個に単純化して移植する。ポート型解決という実利用がまだ無い（9B.2、スコープ外）ため、
// C型の「形」を表現できれば十分で、Rubyのクラス階層は追わない。

export type CType =
  | { readonly kind: "primitive"; readonly name: "void" | "char" | "short" | "int" | "long" | "int64" | "float" | "double" | "bool" }
  | { readonly kind: "pointer"; readonly pointee: CType }
  | { readonly kind: "array"; readonly element: CType; readonly size?: string } // sizeは定数式の生テキスト。評価はしない（9B.2の範囲外）
  | { readonly kind: "function"; readonly returns: CType } // パラメータ型は9B.2の範囲外につき保持しない
  | { readonly kind: "struct"; readonly tag?: string; readonly members?: readonly CStructMember[] } // タグ参照のみなら members は undefined
  | { readonly kind: "defined"; readonly name: string }; // 他のtypedef名への参照（Ruby版のCDefinedType）

export interface CStructMember {
  readonly name: string;
  readonly type: CType;
}

export interface CStructDef {
  readonly tag: string;
  readonly members: readonly CStructMember[];
}

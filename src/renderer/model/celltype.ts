// TECSCDE-TS内部仕様 3.2 — CelltypeRef。参照のみを保持する値クラス、編集対象には含めない。

import type { EdgeSide, PortArrayKind } from "./port";
import type { CompositeStructure } from "./composite";

/** セルタイプが持つポートの雛形。セル生成時にCPort/EPortへ複製される（require指定は含めない、4.3.1）。 */
export interface PortTemplate {
  readonly name: string;
  readonly signature: string;
  readonly edgeSide: EdgeSide;
  readonly offset: number;
  readonly subscript: number | null;
  readonly arraySize: number | null;
  /** 可変長配列（`[]`）。セル生成時に、結合で使われた添字の最大値+1個の要素へ展開する。 */
  readonly variableArray?: boolean;
  /** 配列種別（非配列・固定長・可変長・未解決）。 */
  readonly arrayKind?: PortArrayKind;
}

/** PortTemplate から配列種別を導出する（未指定時は既存フィールドから互換解決）。 */
export function portTemplateArrayKind(t: PortTemplate): PortArrayKind {
  if (t.arrayKind !== undefined) return t.arrayKind;
  if (t.arraySize !== null) return "fixed";
  if (t.variableArray) return "variable";
  return "none";
}

/** 修飾名（例: `nMruby::tBridge`、`::nA::nB::tFoo`）から名前空間部分を取り出す。無ければ undefined。 */
export function extractNamespaceFromQualifiedName(name: string): string | undefined {
  const trimmed = name.replace(/^::/, "");
  const separator = trimmed.lastIndexOf("::");
  if (separator <= 0) return undefined;
  return normalizeNamespace(trimmed.slice(0, separator));
}

/** 名前空間文字列を正規化する（先頭・末尾の `::` を除去し、空なら undefined）。 */
export function normalizeNamespace(namespace: string | undefined): string | undefined {
  if (!namespace) return undefined;
  const trimmed = namespace.replace(/^::+/, "").replace(/::+$/, "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface CelltypeRefCreateParams {
  readonly name: string;
  /** 定義元の名前空間（先頭 `::` なし、ルート定義は undefined）。省略時は `name` の `::` から補完する。 */
  readonly namespace?: string;
  readonly cportTemplates: readonly PortTemplate[];
  readonly eportTemplates: readonly PortTemplate[];
  readonly attributeNames: readonly string[];
  readonly attributeOptions?: ReadonlyMap<string, readonly string[]>;
  /** requireのため図に現れないポート数。ステータス表示・警告用（4.3.2）。 */
  readonly hiddenRequirePortCount: number;
  /** 定義元ファイル。未解決セルタイプ由来のセルは持たない。 */
  readonly locale?: string;
  /** Stable defining file path; locale remains the display basename. */
  readonly sourcePath?: string;
  /** Generated definitions have virtual sources, never stable temporary file paths. */
  readonly generated?: boolean;
  /** 定義している CDL ファイルのフルパス。詳細ダイアログに出す。パスを持たない型（Plugin 生成、新規作成）は無い。 */
  readonly definitionPath?: string;
  readonly composite?: CompositeStructure;
  readonly hasUnsupportedSyntax?: boolean;
  readonly active?: boolean;
}

export class CelltypeRef {
  private constructor(
    readonly name: string,
    readonly cportTemplates: readonly PortTemplate[],
    readonly eportTemplates: readonly PortTemplate[],
    readonly attributeNames: readonly string[],
    readonly hiddenRequirePortCount: number,
    readonly locale: string | undefined,
    readonly sourcePath: string | undefined,
    readonly generated: boolean,
    readonly composite: CompositeStructure | undefined,
    readonly hasUnsupportedSyntax: boolean,
    readonly active: boolean,
    readonly attributeOptions: ReadonlyMap<string, readonly string[]> = new Map(),
    readonly definitionPath: string | undefined = undefined,
    readonly namespace: string | undefined = undefined,
  ) {}

  static create(params: CelltypeRefCreateParams): CelltypeRef {
    const namespace =
      params.namespace !== undefined
        ? normalizeNamespace(params.namespace)
        : extractNamespaceFromQualifiedName(params.name);
    return new CelltypeRef(
      params.name,
      params.cportTemplates,
      params.eportTemplates,
      params.attributeNames,
      params.hiddenRequirePortCount,
      params.locale,
      params.sourcePath,
      params.generated ?? false,
      params.composite,
      params.hasUnsupportedSyntax ?? false,
      params.active ?? false,
      params.attributeOptions ?? new Map(),
      params.definitionPath,
      namespace,
    );
  }

  getAttributeOptions(attrName: string): readonly string[] | undefined {
    return this.attributeOptions.get(attrName);
  }
}

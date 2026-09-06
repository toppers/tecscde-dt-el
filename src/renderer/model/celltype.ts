// TECSCDE-TS内部仕様 3.2 — CelltypeRef。参照のみを保持する値クラス、編集対象には含めない。

import type { EdgeSide } from "./port";

/** セルタイプが持つポートの雛形。セル生成時にCPort/EPortへ複製される（require指定は含めない、4.3.1）。 */
export interface PortTemplate {
  readonly name: string;
  readonly signature: string;
  readonly edgeSide: EdgeSide;
  readonly offset: number;
  readonly subscript: number | null;
  readonly arraySize: number | null;
}

export interface CelltypeRefCreateParams {
  readonly name: string;
  readonly cportTemplates: readonly PortTemplate[];
  readonly eportTemplates: readonly PortTemplate[];
  readonly attributeNames: readonly string[];
  /** requireのため図に現れないポート数。ステータス表示・警告用（4.3.2）。 */
  readonly hiddenRequirePortCount: number;
  /** 定義元ファイル。未解決セルタイプ由来のセルは持たない。 */
  readonly locale?: string;
}

export class CelltypeRef {
  private constructor(
    readonly name: string,
    readonly cportTemplates: readonly PortTemplate[],
    readonly eportTemplates: readonly PortTemplate[],
    readonly attributeNames: readonly string[],
    readonly hiddenRequirePortCount: number,
    readonly locale: string | undefined,
  ) {}

  static create(params: CelltypeRefCreateParams): CelltypeRef {
    return new CelltypeRef(
      params.name,
      params.cportTemplates,
      params.eportTemplates,
      params.attributeNames,
      params.hiddenRequirePortCount,
      params.locale,
    );
  }
}

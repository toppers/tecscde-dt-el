// TECSCDE-TS内部仕様 3.2 — Port階層。
// 「呼び口(CPort)は結合が最大1本、受け口(EPort)は複数可」（外部仕様4.3.1・4.4.1）を
// invariants.tsの事後検証ではなく、フィールドの型そのもの（単一値 vs 配列）で表現する。

import { InvariantViolation } from "./errors";
import type { JoinId } from "./ids";

export type EdgeSide = "TOP" | "BOTTOM" | "LEFT" | "RIGHT";

export interface PortCreateParams {
  readonly name: string;
  /** シグニチャ名の参照のみ（外部仕様4.5.2: 定義は編集しない）。 */
  readonly signature: string;
  readonly edgeSide: EdgeSide;
  /** 辺上のオフセット(mm)。上辺・下辺なら左端から、左辺・右辺なら上端から。 */
  readonly offset: number;
  /** 配列ポートの添字。非配列なら null。 */
  readonly subscript?: number | null;
  /** 固定長配列のサイズ。可変長・非配列は null。 */
  readonly arraySize?: number | null;
}

/** 抽象基底。それ自体はインスタンス化しない（3.2節の表）。 */
export abstract class Port {
  protected constructor(
    readonly name: string,
    readonly signature: string,
    readonly edgeSide: EdgeSide,
    readonly offset: number,
    readonly subscript: number | null,
    readonly arraySize: number | null,
  ) {}
}

/** 呼び口（Call Port）。結合は最大1本（外部仕様4.3.1、10.3 #3）。 */
export class CPort extends Port {
  private constructor(
    name: string,
    signature: string,
    edgeSide: EdgeSide,
    offset: number,
    subscript: number | null,
    arraySize: number | null,
    readonly joinId: JoinId | null,
  ) {
    super(name, signature, edgeSide, offset, subscript, arraySize);
  }

  static create(params: PortCreateParams): CPort {
    return new CPort(
      params.name,
      params.signature,
      params.edgeSide,
      params.offset,
      params.subscript ?? null,
      params.arraySize ?? null,
      null,
    );
  }

  withEdge(edgeSide: EdgeSide, offset: number): CPort {
    return new CPort(this.name, this.signature, edgeSide, offset, this.subscript, this.arraySize, this.joinId);
  }

  withJoin(joinId: JoinId): CPort {
    if (this.joinId !== null) {
      throw new InvariantViolation(`CPort ${this.name} already has a join`);
    }
    return new CPort(this.name, this.signature, this.edgeSide, this.offset, this.subscript, this.arraySize, joinId);
  }

  withoutJoin(): CPort {
    return new CPort(this.name, this.signature, this.edgeSide, this.offset, this.subscript, this.arraySize, null);
  }
}

/** 受け口（Entry Port）。結合は複数可（外部仕様4.4.1、10.3 #3）。 */
export class EPort extends Port {
  private constructor(
    name: string,
    signature: string,
    edgeSide: EdgeSide,
    offset: number,
    subscript: number | null,
    arraySize: number | null,
    readonly joinIds: readonly JoinId[],
  ) {
    super(name, signature, edgeSide, offset, subscript, arraySize);
  }

  static create(params: PortCreateParams): EPort {
    return new EPort(
      params.name,
      params.signature,
      params.edgeSide,
      params.offset,
      params.subscript ?? null,
      params.arraySize ?? null,
      [],
    );
  }

  withEdge(edgeSide: EdgeSide, offset: number): EPort {
    return new EPort(this.name, this.signature, edgeSide, offset, this.subscript, this.arraySize, this.joinIds);
  }

  withJoin(joinId: JoinId): EPort {
    return new EPort(this.name, this.signature, this.edgeSide, this.offset, this.subscript, this.arraySize, [
      ...this.joinIds,
      joinId,
    ]);
  }

  withoutJoin(joinId: JoinId): EPort {
    return new EPort(
      this.name,
      this.signature,
      this.edgeSide,
      this.offset,
      this.subscript,
      this.arraySize,
      this.joinIds.filter((j) => j !== joinId),
    );
  }
}

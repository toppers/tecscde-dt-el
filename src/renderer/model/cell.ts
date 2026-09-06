// TECSCDE-TS内部仕様 3.2 — Cellクラス。static create()でALIGN丸め・識別子構文を検証する。

import { alignRound } from "./align";
import { assertIdentifierSyntax } from "./identifier";
import type { CellId, RegionId } from "./ids";
import type { CPort, EPort } from "./port";

export interface CellCreateParams {
  readonly id: CellId;
  readonly name: string;
  readonly celltypeName: string;
  readonly x: number; // mm。ALIGN丸めはcreate/moveTo内で強制する
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly regionId: RegionId;
  /** 10.2.1: 定義元ファイル(locale)が編集対象ファイル自身かどうかで決まる。 */
  readonly editable: boolean;
  readonly cports: readonly CPort[];
  readonly eports: readonly EPort[];
  readonly attrs: Readonly<Record<string, string>>;
  /** セルタイプが解決できない場合（外部仕様5.3.2: 削除せず表示する）。 */
  readonly celltypeUnresolved: boolean;
  /** 定義元ファイル名。保存時のdirect_import相当の判定に使う（10.2.1）。 */
  readonly locale?: string;
}

export class Cell {
  private constructor(
    readonly id: CellId,
    readonly name: string,
    readonly celltypeName: string,
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
    readonly regionId: RegionId,
    readonly editable: boolean,
    readonly cports: readonly CPort[],
    readonly eports: readonly EPort[],
    readonly attrs: Readonly<Record<string, string>>,
    readonly celltypeUnresolved: boolean,
    readonly locale: string | undefined,
  ) {}

  static create(params: CellCreateParams): Cell {
    assertIdentifierSyntax(params.name); // 4.8.1, 6.5.1
    return new Cell(
      params.id,
      params.name,
      params.celltypeName,
      alignRound(params.x),
      alignRound(params.y),
      alignRound(params.width),
      alignRound(params.height),
      params.regionId,
      params.editable,
      params.cports,
      params.eports,
      params.attrs,
      params.celltypeUnresolved,
      params.locale,
    );
  }

  moveTo(x: number, y: number): Cell {
    return new Cell(
      this.id,
      this.name,
      this.celltypeName,
      alignRound(x),
      alignRound(y),
      this.width,
      this.height,
      this.regionId,
      this.editable,
      this.cports,
      this.eports,
      this.attrs,
      this.celltypeUnresolved,
      this.locale,
    );
  }

  withCPort(port: CPort): Cell {
    const cports = this.cports.map((p) => (p.name === port.name ? port : p));
    return new Cell(
      this.id,
      this.name,
      this.celltypeName,
      this.x,
      this.y,
      this.width,
      this.height,
      this.regionId,
      this.editable,
      cports,
      this.eports,
      this.attrs,
      this.celltypeUnresolved,
      this.locale,
    );
  }

  withEPort(port: EPort): Cell {
    const eports = this.eports.map((p) => (p.name === port.name ? port : p));
    return new Cell(
      this.id,
      this.name,
      this.celltypeName,
      this.x,
      this.y,
      this.width,
      this.height,
      this.regionId,
      this.editable,
      this.cports,
      eports,
      this.attrs,
      this.celltypeUnresolved,
      this.locale,
    );
  }

  findCPort(name: string): CPort | undefined {
    return this.cports.find((p) => p.name === name);
  }

  findEPort(name: string): EPort | undefined {
    return this.eports.find((p) => p.name === name);
  }
}

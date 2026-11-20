// モジュールC（モデル）— TECSCDE-TS内部仕様 3章。
// Brand型ユーティリティ。生のstringとの混同を型で防ぐ（3.2）。

type Brand<T, B extends string> = T & { readonly __brand: B };

export type CellId = Brand<string, "CellId">;
export type JoinId = Brand<string, "JoinId">;
export type RegionId = Brand<string, "RegionId">;
export type PortId = Brand<string, "PortId">;

export const asCellId = (s: string): CellId => s as CellId;
export const asJoinId = (s: string): JoinId => s as JoinId;
export const asRegionId = (s: string): RegionId => s as RegionId;
export const asPortId = (s: string): PortId => s as PortId;

let portIdSequence = 0;

/** 実行中に一意な PortId を採番する（内部仕様 04E 4E.1）。 */
export function nextPortId(prefix = "port"): PortId {
  portIdSequence += 1;
  return asPortId(`${prefix}:${portIdSequence}`);
}

export const ROOT_REGION_ID = asRegionId("::");

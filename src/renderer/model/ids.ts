// モジュールC（モデル）— TECSCDE-TS内部仕様 3章。
// Brand型ユーティリティ。生のstringとの混同を型で防ぐ（3.2）。

type Brand<T, B extends string> = T & { readonly __brand: B };

export type CellId = Brand<string, "CellId">;
export type JoinId = Brand<string, "JoinId">;
export type RegionId = Brand<string, "RegionId">;

export const asCellId = (s: string): CellId => s as CellId;
export const asJoinId = (s: string): JoinId => s as JoinId;
export const asRegionId = (s: string): RegionId => s as RegionId;

export const ROOT_REGION_ID = asRegionId("::");

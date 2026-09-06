// TECSCDE-TS内部仕様 3章 — __tool_info__("tecsgen")の型（モデル層で保持するのみ、5.1.2）。
// パース・直列化ロジック自体はモジュールB（cdl/tool-info.ts の ToolInfoValidator）が持つ。
// モデル(C)はモジュールB(cdl)に依存しない（2.1節の依存方向）ため、型定義はここに置く。

export interface ToolInfoTecsgen {
  readonly tecscdeVersion?: string;
  readonly cdeFormatVersion?: string;
  readonly savedAt?: string;
  readonly baseDir?: string;
  readonly defineMacro?: readonly string[];
  readonly importPath?: readonly string[];
  readonly directImport?: readonly string[];
  readonly cpp?: string;
  readonly unknownFields: Readonly<Record<string, unknown>>;
}

export const CDE_FORMAT_VERSION = "0.1.0.0";
export const TECSCDE_TS_VERSION = "0.1.0";

export function emptyToolInfoTecsgen(): ToolInfoTecsgen {
  return { unknownFields: {} };
}

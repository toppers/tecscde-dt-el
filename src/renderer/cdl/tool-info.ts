// TECSCDE-TS内部仕様 2.2 — __tool_info__ ブロックの抽出とスキーマ検証（ToolInfoValidator）。
//
// 外部仕様5.1.1: __tool_info__ の中身は「JSON形式」で記述される。
// `__tool_info__("name")` の直後にある波括弧のバランスを文字列リテラルを考慮して数え、
// その範囲をそのまま JSON.parse する。CDL本体の構文解析(CdlDocumentBuilder)にJSON構文
// （コロン等）を覚えさせないための前処理として、抽出した範囲は空白に置換してから
// 本体のトークナイズに渡す（行番号・桁番号を保つため改行は残す）。

import type { PaperOrientation, PaperSize } from "../model/paper";
import { CDE_FORMAT_VERSION, type ToolInfoTecsgen } from "../model/tool-info-types";
import type { Diagnostic } from "../diagnostics/types";

export interface RawToolInfoBlock {
  readonly toolName: string;
  readonly json: string;
  readonly line: number;
  readonly column: number;
}

export interface ExtractResult {
  readonly blocks: RawToolInfoBlock[];
  readonly sourceWithBlanks: string;
}

export interface PortLayout {
  readonly edge: "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
  readonly offset: number;
}

export interface CellLayout {
  readonly location: readonly [number, number, number, number];
  readonly region?: string;
  readonly ports?: Readonly<Record<string, PortLayout>>;
}

export interface BarLayout {
  readonly dir: "H" | "V";
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
}

export interface JoinLayout {
  readonly cell: string;
  readonly cport: string;
  readonly targetCell: string;
  readonly eport: string;
  readonly bars: readonly BarLayout[];
}

export interface ToolInfoTecscdeParsed {
  readonly paper?: { size: PaperSize; orientation?: PaperOrientation };
  readonly cellList: Readonly<Record<string, CellLayout>>;
  readonly joinList: Readonly<Record<string, JoinLayout>>;
  readonly unknownFields: Readonly<Record<string, unknown>>;
}

interface ToolInfoTecsgenJson {
  tecscde_version?: string;
  cde_format_version?: string;
  saved_at?: string;
  base_dir?: string;
  define_macro?: string[];
  import_path?: string[];
  direct_import?: string[];
  cpp?: string;
  [key: string]: unknown;
}

const VALID_PAPER_SIZES: readonly PaperSize[] = ["A4", "A3", "A2"];
const VALID_ORIENTATIONS: readonly PaperOrientation[] = ["LANDSCAPE", "PORTRAIT"];
const VALID_EDGES = ["TOP", "BOTTOM", "LEFT", "RIGHT"];

function lineColAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function blank(source: string, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i += 1) {
    out += source[i] === "\n" ? "\n" : " ";
  }
  return source.slice(0, start) + out + source.slice(end);
}

function isValidCellLayout(value: unknown): value is CellLayout {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.location) || v.location.length !== 4) return false;
  if (!v.location.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (v.ports !== undefined) {
    if (typeof v.ports !== "object" || v.ports === null) return false;
    for (const p of Object.values(v.ports as Record<string, unknown>)) {
      if (typeof p !== "object" || p === null) return false;
      const port = p as Record<string, unknown>;
      if (!VALID_EDGES.includes(port.edge as string)) return false;
      if (typeof port.offset !== "number") return false;
    }
  }
  return true;
}

/** __tool_info__ ブロックの抽出・スキーマ検証を担う。副作用なし・状態を持たない（2.2節）。 */
export class ToolInfoValidator {
  static extractBlocks(source: string): ExtractResult {
    const blocks: RawToolInfoBlock[] = [];
    let working = source;
    const KEYWORD = "__tool_info__";
    let searchFrom = 0;

    for (;;) {
      const kwIndex = working.indexOf(KEYWORD, searchFrom);
      if (kwIndex === -1) break;

      let cursor = kwIndex + KEYWORD.length;
      while (/\s/.test(working[cursor] ?? "")) cursor += 1;
      if (working[cursor] !== "(") {
        searchFrom = kwIndex + KEYWORD.length;
        continue;
      }
      cursor += 1;
      while (/\s/.test(working[cursor] ?? "")) cursor += 1;
      if (working[cursor] !== '"') {
        searchFrom = kwIndex + KEYWORD.length;
        continue;
      }
      cursor += 1;
      let toolName = "";
      while (working[cursor] !== '"' && cursor < working.length) {
        toolName += working[cursor];
        cursor += 1;
      }
      cursor += 1; // closing quote
      while (/\s/.test(working[cursor] ?? "")) cursor += 1;
      if (working[cursor] !== ")") {
        searchFrom = kwIndex + KEYWORD.length;
        continue;
      }
      cursor += 1;
      while (/\s/.test(working[cursor] ?? "")) cursor += 1;
      if (working[cursor] !== "{") {
        searchFrom = kwIndex + KEYWORD.length;
        continue;
      }

      const jsonStart = cursor;
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let i = jsonStart; i < working.length; i += 1) {
        const c = working[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (c === "\\") {
            escaped = true;
          } else if (c === '"') {
            inString = false;
          }
          continue;
        }
        if (c === '"') {
          inString = true;
          continue;
        }
        if (c === "{") depth += 1;
        if (c === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }

      if (end === -1) break;

      const json = working.slice(jsonStart, end);
      const { line, column } = lineColAt(source, kwIndex);
      blocks.push({ toolName, json, line, column });

      working = blank(working, kwIndex, end);
      searchFrom = end;
    }

    return { blocks, sourceWithBlanks: working };
  }

  /** 5.1.2: JS版は解釈せず往復保持するだけ。 */
  static parseTecsgen(json: string): ToolInfoTecsgen {
    let obj: ToolInfoTecsgenJson;
    try {
      obj = JSON.parse(json) as ToolInfoTecsgenJson;
    } catch {
      return { unknownFields: {} };
    }
    const {
      tecscde_version,
      cde_format_version,
      saved_at,
      base_dir,
      define_macro,
      import_path,
      direct_import,
      cpp,
      ...rest
    } = obj;
    return {
      tecscdeVersion: tecscde_version,
      cdeFormatVersion: cde_format_version,
      savedAt: saved_at,
      baseDir: base_dir,
      defineMacro: define_macro,
      importPath: import_path,
      directImport: direct_import,
      cpp,
      unknownFields: rest,
    };
  }

  static serializeTecsgen(info: ToolInfoTecsgen): string {
    const obj: ToolInfoTecsgenJson = {
      ...info.unknownFields,
      tecscde_version: info.tecscdeVersion,
      cde_format_version: info.cdeFormatVersion,
      saved_at: info.savedAt,
      base_dir: info.baseDir,
      define_macro: info.defineMacro ? [...info.defineMacro] : undefined,
      import_path: info.importPath ? [...info.importPath] : undefined,
      direct_import: info.directImport ? [...info.directImport] : undefined,
      cpp: info.cpp,
    };
    for (const key of Object.keys(obj) as (keyof ToolInfoTecsgenJson)[]) {
      if (obj[key] === undefined) delete obj[key];
    }
    return JSON.stringify(obj, null, 2);
  }

  /** 5.1.2: 保存された形式版数が本ツールの対応版数より新しい場合は警告するが読み込みは続行する。 */
  static checkFormatVersion(info: ToolInfoTecsgen): Diagnostic | undefined {
    if (!info.cdeFormatVersion) return undefined;
    if (info.cdeFormatVersion > CDE_FORMAT_VERSION) {
      return {
        severity: "warning",
        code: "W-NEWER-FORMAT",
        message: `保存された形式版数 (${info.cdeFormatVersion}) は本ツールの対応版数 (${CDE_FORMAT_VERSION}) より新しいため、一部の情報が正しく解釈されない場合があります`,
      };
    }
    return undefined;
  }

  /** __tool_info__("tecscde") のJSONを要素単位で検証する（5.5.2）。無効な要素は破棄し警告を出す。 */
  static parseTecscde(json: string): { parsed: ToolInfoTecscdeParsed; diagnostics: Diagnostic[] } {
    const diagnostics: Diagnostic[] = [];
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(json) as Record<string, unknown>;
    } catch {
      diagnostics.push({
        severity: "warning",
        code: "W-LAYOUT-PARSE-ERROR",
        message: '__tool_info__("tecscde") のJSONを解析できませんでした。レイアウトなしで続行します',
      });
      return { parsed: { cellList: {}, joinList: {}, unknownFields: {} }, diagnostics };
    }

    const { paper, cell_list, join_list, ...unknownFields } = obj as {
      paper?: unknown;
      cell_list?: unknown;
      join_list?: unknown;
    };

    let paperOut: ToolInfoTecscdeParsed["paper"];
    if (paper && typeof paper === "object") {
      const p = paper as Record<string, unknown>;
      const size = VALID_PAPER_SIZES.includes(p.size as PaperSize) ? (p.size as PaperSize) : undefined;
      const orientation = VALID_ORIENTATIONS.includes(p.orientation as PaperOrientation)
        ? (p.orientation as PaperOrientation)
        : undefined;
      if (size) {
        paperOut = orientation ? { size, orientation } : { size };
      }
    }

    const cellList: Record<string, CellLayout> = {};
    if (cell_list && typeof cell_list === "object") {
      for (const [name, value] of Object.entries(cell_list as Record<string, unknown>)) {
        if (isValidCellLayout(value)) {
          cellList[name] = value;
        } else {
          diagnostics.push({
            severity: "warning",
            code: "W-LAYOUT-DISCARDED",
            message: `セル \`${name}\` の保存済みレイアウトは形式が不正なため破棄し、自動配置しました`,
          });
        }
      }
    }

    const joinList: Record<string, JoinLayout> = {};
    if (join_list && typeof join_list === "object") {
      for (const [key, value] of Object.entries(join_list as Record<string, unknown>)) {
        const v = value as Partial<JoinLayout> | undefined;
        if (
          v &&
          typeof v.cell === "string" &&
          typeof v.cport === "string" &&
          typeof v.targetCell === "string" &&
          typeof v.eport === "string" &&
          Array.isArray(v.bars)
        ) {
          joinList[key] = v as JoinLayout;
        } else {
          diagnostics.push({
            severity: "warning",
            code: "W-LAYOUT-DISCARDED",
            message: `結合 \`${key}\` の保存済み経路は形式が不正なため破棄し、自動生成しました`,
          });
        }
      }
    }

    return { parsed: { paper: paperOut, cellList, joinList, unknownFields }, diagnostics };
  }

  static serializeTecscde(
    paper: { size: PaperSize; orientation: PaperOrientation },
    cellList: Readonly<Record<string, CellLayout>>,
    joinList: Readonly<Record<string, JoinLayout>>,
    unknownFields: Readonly<Record<string, unknown>>,
  ): string {
    const obj = { ...unknownFields, paper, cell_list: cellList, join_list: joinList };
    return JSON.stringify(obj, null, 2);
  }
}

// V0.3.1 段2 — セル名・セルタイプ名の表示加工（短縮・名前空間の黒丸代替）を担う純関数群。
// セル名短縮: 表示幅（半角=1, 全角=2）が6以下はそのまま、7以上は「先頭2文字 + "--" + 最後尾2文字」。
// 名前空間代替: セル名・セルタイプ名に名前空間（`::`）が含まれる場合のみ名前空間部分を `●` に置換する。

import type { CellNameDisplayMode, NamespaceDisplayMode } from "../../shared/ipc-types";

function charDisplayWidth(ch: string): number {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  // ASCII printable/control & half-width Katakana (U+FF61..U+FF9F) count as 1; full-width counts as 2.
  if (code <= 0x007f || (code >= 0xff61 && code <= 0xff9f)) return 1;
  return 2;
}

/** 文字列の表示幅を返す（半角=1、全角=2）。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of Array.from(text)) {
    width += charDisplayWidth(ch);
  }
  return width;
}

/**
 * セル名本体（名前空間を除いたローカル名）を短縮する。
 * 表示幅が6以下ならそのまま、7以上なら「先頭2文字 + "--" + 最後尾2文字」を返す。
 */
export function shortenCellName(name: string): string {
  if (displayWidth(name) <= 6) return name;
  const chars = Array.from(name);
  return `${chars.slice(0, 2).join("")}--${chars.slice(-2).join("")}`;
}

/** 修飾名から名前空間プレフィックスとローカル名を分離する。名前空間が無い場合は namespace=null。 */
export function splitNamespacePrefix(name: string): { readonly namespace: string | null; readonly localName: string } {
  const sep = name.lastIndexOf("::");
  if (sep < 0) return { namespace: null, localName: name };
  const prefix = name.slice(0, sep);
  const trimmedPrefix = prefix.replace(/^::+/, "");
  if (trimmedPrefix.length === 0) return { namespace: null, localName: name };
  return { namespace: prefix, localName: name.slice(sep + 2) };
}

/**
 * セル名を表示設定に従って整形する。非表示（`"hide"`）のときは `null` を返す。
 * 名前空間が使われている場合のみ `namespaceDisplay === "dot"` で名前空間部分を `●` に置換する。
 */
export function formatCellDisplayLabel(
  cellName: string,
  cellNameDisplay: CellNameDisplayMode,
  namespaceDisplay: NamespaceDisplayMode,
): string | null {
  if (cellNameDisplay === "hide") return null;
  const { namespace, localName } = splitNamespacePrefix(cellName);
  const formattedLocal = cellNameDisplay === "shorten" ? shortenCellName(localName) : localName;
  if (namespace === null) return formattedLocal;
  return namespaceDisplay === "dot" ? `●::${formattedLocal}` : `${namespace}::${formattedLocal}`;
}

/**
 * セルタイプ名を表示設定に従って整形する。
 * 名前空間が使われている場合のみ `namespaceDisplay === "dot"` で名前空間部分を `●` に置換する。
 */
export function formatCelltypeDisplayLabel(
  celltypeName: string,
  namespaceDisplay: NamespaceDisplayMode,
): string {
  const { namespace, localName } = splitNamespacePrefix(celltypeName);
  if (namespace === null) return celltypeName;
  return namespaceDisplay === "dot" ? `●::${localName}` : celltypeName;
}

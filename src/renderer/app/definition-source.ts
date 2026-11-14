import type { GeneratedCdlFile } from "../../shared/ipc-types";

export type DefinitionSource =
  | { readonly kind: "disk"; readonly path: string }
  | { readonly kind: "virtual"; readonly path: string; readonly content: string };

export interface DefinitionLocation {
  readonly label: string;
  readonly source?: DefinitionSource;
  readonly unavailable?: string;
}

function findGeneratedSource(
  generatedSources: readonly GeneratedCdlFile[],
  key: string,
): GeneratedCdlFile | undefined {
  const strip = (s: string) => s.startsWith("plugin:") ? s.slice(7) : s;
  const keyStrip = strip(key);
  const keyNorm = keyStrip.replace(/^\/+/, "");
  const keyBase = keyStrip.split(/[\\/]/).at(-1);

  // 1. 完全一致
  const exact = generatedSources.find((g) => g.fileName === key);
  if (exact) return exact;

  // 2. plugin: を除いたパスが完全一致
  const stripMatch = generatedSources.find((g) => strip(g.fileName) === keyStrip);
  if (stripMatch) return stripMatch;

  // 3. 先頭スラッシュを除いたパスが一致 (/MrubyBridgePlugin/... と MrubyBridgePlugin/...)
  const normMatch = generatedSources.find((g) => strip(g.fileName).replace(/^\/+/, "") === keyNorm);
  if (normMatch) return normMatch;

  // 4. ベースネーム（ファイル名部分）が一致
  const baseMatch = generatedSources.find((g) => {
    const cBase = strip(g.fileName).split(/[\\/]/).at(-1);
    return cBase !== undefined && keyBase !== undefined && cBase === keyBase;
  });
  if (baseMatch) return baseMatch;

  return undefined;
}

/** A basename cannot identify a source: never guess from the current primary. */
export function definitionLocation(
  key: string | undefined,
  generatedSources: readonly GeneratedCdlFile[] = [],
  generated = false,
): DefinitionLocation {
  if (!key) return { label: "パスなし" };
  if (generated || key.startsWith("plugin:")) {
    const strip = (s: string) => s.startsWith("plugin:") ? s.slice(7) : s;
    const virtualName = strip(key);
    const label = key.startsWith("plugin:")
      ? key
      : `plugin:${virtualName.startsWith("/") ? virtualName : (virtualName.split(/[\\/]/).at(-1) ?? virtualName)}`;
    const source = findGeneratedSource(generatedSources, key);
    return source ? { label, source: { kind: "virtual", path: label, content: source.content } }
      : { label, unavailable: "仮想ソースがないため表示できません。" };
  }
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(key)) return { label: "パスなし" };
  return { label: key, source: { kind: "disk", path: key } };
}

export function definitionFooter(
  doc: Document,
  location: DefinitionLocation,
  onShow?: (source: DefinitionSource) => void,
): HTMLElement {
  const footer = doc.createElement("div");
  footer.className = "definition-source";
  const label = doc.createElement("div");
  label.textContent = "定義ファイル";
  const path = doc.createElement("div");
  path.className = "definition-path";
  path.textContent = location.label;
  path.style.overflowWrap = "anywhere";
  path.style.userSelect = "text";
  const button = doc.createElement("button");
  button.type = "button";
  button.dataset["showDefinition"] = "";
  button.textContent = "定義ファイルを表示";
  button.disabled = !location.source || !onShow;
  button.addEventListener("click", () => { if (location.source) onShow?.(location.source); });
  footer.append(label, path, button);
  if (location.unavailable) {
    const reason = doc.createElement("p");
    reason.className = "prop-note";
    reason.textContent = location.unavailable;
    footer.append(reason);
  }
  return footer;
}

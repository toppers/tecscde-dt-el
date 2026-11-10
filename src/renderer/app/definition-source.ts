import type { GeneratedCdlFile } from "../../shared/ipc-types";

export type DefinitionSource =
  | { readonly kind: "disk"; readonly path: string }
  | { readonly kind: "virtual"; readonly path: string; readonly content: string };

export interface DefinitionLocation {
  readonly label: string;
  readonly source?: DefinitionSource;
  readonly unavailable?: string;
}

/** A basename cannot identify a source: never guess from the current primary. */
export function definitionLocation(
  key: string | undefined,
  generatedSources: readonly GeneratedCdlFile[] = [],
  generated = false,
): DefinitionLocation {
  if (!key) return { label: "パスなし" };
  if (generated || key.startsWith("plugin:")) {
    const virtualName = key.startsWith("plugin:") ? key.slice(7) : key.split(/[\\/]/).at(-1)!;
    const label = `plugin:${virtualName}`;
    const source = generatedSources.find((candidate) => candidate.fileName === virtualName);
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

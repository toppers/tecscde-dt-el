/** Classify the supported input extensions without changing the original path. */
export function fileKind(path: string): "cdl" | "options" | undefined {
  if (/\.tecsgen-opts$/i.test(path)) return "options";
  if (/\.(?:cde|cdl)$/i.test(path)) return "cdl";
  return undefined;
}

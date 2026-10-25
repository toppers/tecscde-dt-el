// DT-EL internal spec 6.4: derived search state, independent of selection.
import { setAttrs } from "./element-renderer";
import type { CellId, JoinId } from "../model/ids";

export interface SearchHighlights {
  readonly cellIds: ReadonlySet<CellId>;
  readonly joinIds: ReadonlySet<JoinId>;
}

export function styleSearchHighlight(element: SVGElement, kind: "cell" | "join"): void {
  setAttrs(element, {
    class: `search-highlight search-highlight-${kind}`,
    fill: "none",
    stroke: "#b45309",
    "stroke-width": kind === "cell" ? 3 : 6,
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
    "aria-hidden": "true",
  });
  if (kind === "cell") element.setAttribute("stroke-dasharray", "6 3");
  else setAttrs(element, { "stroke-linecap": "round", "stroke-linejoin": "round" });
}

/** Resolved tokens shared by live drawing and standalone SVG output. */
export const CELL_COLORS = {
  fill: "#ffffff",
  readOnlyFill: "#f0f0f0",
  activeFill: "#dbeafe",
  stroke: "#333333",
  readOnlyStroke: "#999999",
  warningStroke: "#b45309",
  label: "#111111",
  typeLabel: "#4b5563",
} as const;

export function resolveCellAppearance(active: boolean, readOnly: boolean, incomplete: boolean) {
  return {
    fill: active ? CELL_COLORS.activeFill : readOnly ? CELL_COLORS.readOnlyFill : CELL_COLORS.fill,
    stroke: incomplete ? CELL_COLORS.warningStroke : readOnly ? CELL_COLORS.readOnlyStroke : CELL_COLORS.stroke,
    dashArray: incomplete ? "3 2" : "none",
  };
}

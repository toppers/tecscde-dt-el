// 画面と単独 SVG エクスポートで共有する図要素のスタイル（内部仕様7F.10.4）。
export const SVG_STYLES = `
svg text { font-family: system-ui, "Segoe UI", sans-serif; }
.cell-rect { fill: #ffffff; stroke: #333333; stroke-width: 1; }
.cell-rect.readonly { fill: #f0f0f0; stroke: #999999; }
.cell-rect.unresolved { stroke: #d29922; stroke-dasharray: 3 2; }
.cell-label { font-size: 11px; fill: #111111; }
.cell-label.emphasized { font-size: 14px; font-weight: 600; }
.celltype-label { font-size: 9px; fill: #666666; }
.port-symbol { stroke: #333333; stroke-width: 0.75; }
.port-symbol-cport { fill: #ffffff; }
.port-symbol-eport { fill: #333333; }
.join-line, .join-stub-tick { stroke: #444444; stroke-width: 1.25; }
.signature-label { font-size: 9px; fill: #555555; }
.grid-line { stroke: #e2e2e2; stroke-width: 0.5; }
.selection-outline { stroke: #1f6feb; stroke-width: 1.5; stroke-dasharray: 4 2; }
.selection-outline.join-selected { stroke-width: 2.5; }
.join-preview { stroke: #1f6feb; stroke-width: 1.5; stroke-dasharray: 5 3; }
.rubber-band { stroke: #1f6feb; stroke-width: 1; stroke-dasharray: 3 2; }
.export-frame { fill: none; stroke: #333333; stroke-width: 1; }
.export-filename { font-size: 9px; fill: #333333; }
`;

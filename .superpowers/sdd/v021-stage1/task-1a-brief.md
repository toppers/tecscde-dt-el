# Stage 1A — Diagnostics panel and selected directory path

Implement only the two Stage 1 UX items from the V0.2.1 plan. Follow these binding requirements:

## Diagnostics panel
- The panel must never overlap the canvas. Put it in its own layout row between canvas and status bar. Canvas position/origin, zoom, selection and document contents must not change when opening/closing it; canvas height changes with the panel and is recalculated through the existing resize path/ResizeObserver.
- Preserve the existing count-button toggle, hidden behavior at zero diagnostics, automatic opening when diagnostics appear, four-column list, and jump behavior.
- Height must fit the actual number of diagnostic rows up to ten; for more than ten, cap at ten rows and scroll within the panel. Preserve a usable canvas minimum height.
- Add DOM contract tests for no overlap, height change/restore, state preservation, ten-row cap/internal scrolling, and auto-open without overlap.
- Specs: Vault `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 09 エラーと警告.md` §9.6 and `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08 整合性チェックとメッセージ設計.md` §8.7.

## Selected directory full path
- In the file browser dialog, display the selected tree directory's full path above the tree. Directory click updates selected path; successful root selection/restoration selects root; cancel and file click do not alter it.
- Display the exact path as provided, without shortening, normalization, or ellipsis. Use textContent. When no root is selected, show a clear placeholder.
- Add focused tests for selection, cancel/file click stability, exact rendering, and safe text rendering.
- Specs: Vault `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md` §3.5.1 and `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07B ファイルブラウザ設計.md` §7.6.3.1.

## Ownership and safety
- You own only diagnostics-panel and file-browser UI code plus their tests, and the smallest necessary shell/HTML/CSS wiring for the diagnostics layout. Existing `src/renderer/app/shell.ts`, `src/renderer/index.html`, and tests may already contain unrelated dirty stage-4 work. Inspect and preserve it; do not overwrite or revert it.
- Do not edit files owned by Stage 1B (clear/manual-add behavior). Do not spawn agents. Do not commit, stash, reset, clean, or revert anything.
- Work in current workspace; use test-first development and run focused tests. Report exact changed paths and commands/results. Write full report to `.superpowers/sdd/v021-stage1/task-1a-report.md`.

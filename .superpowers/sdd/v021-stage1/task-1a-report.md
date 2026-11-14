# Stage 1A implementation report

Status: complete; focused unit/DOM tests, renderer typecheck and actual Chromium geometry checks pass. No commit, stash, reset, revert or git clean was performed. Existing unrelated dirty changes were preserved.

## Scope and references

- Vault `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 09 エラーと警告.md` 9.6 and `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08 整合性チェックとメッセージ設計.md` 8.7: diagnostics placement/sizing.
- Vault `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md` 3.5.1 and `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07B ファイルブラウザ設計.md` 7.6.3.1: exact selected directory path.
- Lead clarification: keep the existing single-text diagnostic rows and jump behavior; the four-column 9.2 discrepancy belongs to a separate issue. No four-column conversion was retained.

## Changes

- Diagnostics now occupy a normal flex row between `#main` and `#statusbar`, rather than an absolute overlay inside the status bar. Hidden/zero-diagnostic panels consume no layout space.
- Opening diagnostics when their count increases preserves automatic visibility, and the existing count button can still close/reopen them. A dismissed panel remains dismissed during ordinary redraws with the same count.
- The maximum panel content height is the sum of the first ten actual `.diag-item` bounding rectangles, including padding, borders and wrapped content. A wrapped message counts as one diagnostic. Ten or fewer diagnostics fit their natural height; additional diagnostics scroll inside the panel. The canvas row has a 120px minimum; in constrained windows it takes priority over displaying ten full diagnostics.
- A canvas `ResizeObserver` updates the viewport-derived pan center through the existing store/render route while preserving actual scroll offsets, zoom, document and selection. It disconnects on shell disposal.
- Canvas vertical alignment is now at the top, and a stable scrollbar gutter prevents opening the panel from moving a small centered sheet horizontally. Horizontal sheet centering is retained. The status bar has a 30px minimum to prevent the diagnostic count button from separately changing its height.
- `FileBrowserView` retains `selectedDir` as view-local state. It displays the exact supplied string with `textContent` above the tree; CSS wraps long paths without ellipsis. Directory click selects the directory as well as toggling expansion. Successful root choice/restoration selects the root; cancel and file click keep the selection. Failed restoration clears the path. The no-root placeholder appears once.

## Changed paths owned by this task

- `src/renderer/app/diagnostics-panel.ts`
- `src/renderer/app/file-browser-panel.ts`
- `src/renderer/app/shell.ts` — only resize observer registration/helper; existing stage-4 hunks preserved.
- `src/renderer/index.html` — diagnostics row/CSS, selected-path CSS, canvas alignment/gutter and stable status-bar height; existing stage-4 hunks preserved.
- `tests/renderer/file-browser-panel.test.ts`
- `tests/renderer/shell.dom.test.ts` — two diagnostics expectations updated for automatic opening.
- `tests/renderer/stage1-diagnostics.dom.test.ts`
- `tests/verification/stage1-diagnostics.electron.cjs`
- `.superpowers/sdd/v021-stage1/task-1a-report.md`

Runtime evidence files (ignored `.log` files, not added to Git): `tests/verification/stage1-diagnostics.stdout.log`, `tests/verification/stage1-diagnostics.stderr.log`.

## TDD and verification

1. Before production edits: `node node_modules/vitest/vitest.mjs run tests/renderer/file-browser-panel.test.ts tests/renderer/stage1-diagnostics.dom.test.ts` — expected RED, 5 failures / 11 passing. Missing selected path, overlay DOM placement, fixed 240px cap and missing automatic opening were observed.
2. Final focused run: `node node_modules/vitest/vitest.mjs run tests/renderer/file-browser-panel.test.ts tests/renderer/stage1-diagnostics.dom.test.ts tests/renderer/shell.dom.test.ts tests/renderer/stage2-panel-lifecycle.test.ts tests/renderer/stage2-shell.dom.test.ts` — GREEN, 5 suites / 106 tests passed.
3. `node node_modules/typescript/bin/tsc -p tsconfig.renderer.json --noEmit` — exit 0.
4. Actual Chromium geometry: launch `node_modules/electron/dist/electron.exe tests/verification/stage1-diagnostics.electron.cjs` using PowerShell `Start-Process -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput tests/verification/stage1-diagnostics.stdout.log -RedirectStandardError tests/verification/stage1-diagnostics.stderr.log`. Exit 0; final output: `PASS: Chromium diagnostics geometry, row cap, wrapping, scroll and state preservation`.
   - 150% zoom: scrollTop 344 and sheet origin preserved through opening/closing; viewport 732.8125px -> 650.8125px for an 82px panel -> 732.8125px after closing.
   - 25% zoom: small sheet origin remained x=393.640625, y=72.1875 across opening/closing.
   - Three diagnostics: 81px panel content / 82px outer panel; twelve diagnostics: 270px content cap, scrollHeight 324px. Auto-open has no canvas-viewport overlap.
   - Wrapped diagnostics exceed one physical text line and preserve the 120px canvas minimum.
   - Document, selection, history, dirty state and zoom identities/values are preserved.
5. `git diff --check` — exit 0, no whitespace errors. Git emitted only LF-to-CRLF conversion notices for dirty files; no normalization was performed.

The Electron check bundles a self-contained fixture into a uniquely created OS temp directory, uses a hidden BrowserWindow and no real file/settings gateway. Cleanup validates that directory before removing it.

## Concerns / integration notes

- Full `npm run check` is left to the integrating lead because other independently owned Stage 1B and pre-existing stage-4 edits share the workspace.
- The current four-column external-spec discrepancy remains intentionally outside this task per lead clarification; existing diagnostic content and click-to-jump are unchanged.
- The viewport-derived internal `panCenter` changes on resize to preserve the actual top-left canvas position and scroll offsets. Diagram coordinates, zoom, selection and saved document content do not change.
- The source's horizontal `safe center` behavior is retained; vertical centering was removed because it inherently moved small sheets when panel height changed.

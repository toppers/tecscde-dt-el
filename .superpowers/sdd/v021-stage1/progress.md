# SDD ledger — plan: Vault/work/active/TECSCDE-DT-EL実装/TECSCDE-DT-EL実装 — V0.2.1 実装計画 — 2026-11-12.md

## Scope and constraints
- Stage 1 only: diagnostics panel placement and sizing; selected directory full path; audit #16 clear preserves reference source body/unsaved edits; audit #17 permits Ctrl-add as a reference when primary is null, with recursive imports and state preservation.
- Preserve the existing dirty worktree. No clean/reset/revert/stash/commit/push/tag.
- Base HEAD: 8c819b2. User-authorized existing worktree; do not create or switch branches.
- V0.2.0 release is confirmed complete in current session; plan note's earlier statement that publication was pending is stale.

## Preflight conflict scan
| Tasks | Shared output/interface | Finding | Ruling |
|---|---|---|---|
| Stage 1A: diagnostics + file browser; Stage 1B: audit #16/#17 | No expected shared implementation files. Stage 1A owns diagnostics-panel/file-browser UI and matching tests; Stage 1B owns clear/manual-add source behavior and matching tests. | Independent code paths; verify touched paths against pre-existing dirty diff before and after each task. | Proceed in parallel with strict file ownership; resolve any incidental overlap before editing. |
| Stage 1A internal consistency | Tests for geometry/height, auto-open, path state/rendering against UI implementation. | Plan and referenced contracts agree; use ResizeObserver/resize path and avoid unsafe HTML. | Implement against accepted external/internal requirements. |
| Stage 1B internal consistency | Clear preserves source text and dirty edits; Stage 1 plan table's short label for #17 says "無通知で拒否". | Detailed external §17 (lines 80-86) and internal §17 (lines 172-188) both require successful Ctrl-add as a reference with primary null, recursive import resolution, unsaved-state preservation, and stale/failure guards. The short label describes the defect, not the fix. | Ruling: implement detailed external/internal #17 contracts; do not implement notification-only refusal. Update plan summary to clarify. Cost if wrong: could change primary-null Ctrl-add behavior beyond intended user expectation or leave the specified add workflow unavailable. |

## Task reports
- 1A: complete; focused tests and hidden/visible Chromium checks pass.
- 1B: complete; focused tests and review follow-up on recursive context/failure guard pass. #17 ruling recorded above.

## Integration / verification
- `npm run check`: initial combined run PASS (87 files passed / 1 skipped; 880 tests passed / 5 skipped; build and depcruise pass), log `tests/verification/stage1-check.log`. Superseded by final passing run below.
- Electron practical verification: PASS for visible diagnostics 10-row independent layout, toggle restoring canvas height, selected full directory path wrapping; screenshots `tests/verification/stage1-visible-{open,closed,path}.png`. Hidden Chromium script also PASS.
- Vault plan and audit-list updates: updated V0.2.1 plan and 69-item list; final completion recorded after #17 review fixes and final check.


## Final integration result (2026-11-12)
- Review follow-up fixed and independently re-reviewed with no remaining findings.
- Final npm run check: PASS, 87 files passed / 1 skipped, 882 tests passed / 5 skipped; build and depcruise PASS. Log: tests/verification/stage1-check.log.
- Visible source fixture: PASS (exit 0), actual AppShell clear button DOM click, real temp CDL reads/writes, unsaved Ref count=42/body/dirty retained after clear and recursive null-primary add. Evidence: tests/verification/stage1-sources.electron.cjs, stage1-sources-{before,cleared,added}.png, stage1-sources.stdout.log.
- Native Orca click for source fixture refused window_not_focused even with restore-window; used visible renderer DOM click and capturePage plus assertions. Ctrl key delivery and OS picker are not covered by this fixture.
- Vault plan and 69-item list updated to Stage 1 complete. Existing dirty files preserved; no commits/push/tags/stash/reset.

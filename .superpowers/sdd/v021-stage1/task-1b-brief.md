# Stage 1B — Audit #16 and #17 behavior

Implement only the two audit items assigned to Stage 1.

## Audit #16: Clear preserves reference source text and edits
- Clearing selected/all diagram objects must not remove referenced-source bodies, including unsaved edits, from the model/session.
- Keep clear limited to the intended editable diagram state; preserve source metadata and source contents. Add a regression test that begins with reference source text containing an unsaved change, runs the clear operation, and proves the body remains byte-for-byte available in the resulting model (and survives save serialization if that is the relevant boundary).

## Audit #17: Ctrl manual-add when the primary is undetermined
- The external and internal audit contracts agree: a new/empty diagram with no determined primary is not excluded from Ctrl-add. Keep the added CDL as a reference; do not promote it to primary. The operation must preserve the current primary (including its unsaved edits), current references, baselines, and source order, while adding only new ordinary sources and recursively resolving imports relative to the added source.
- Fix the current silent early return for a missing editable path. Use the nullable-primary reference-add flow and existing async generation/revision guards. Duplicate paths are no-ops. On failure or stale completion preserve the old document/session; save the updated session only after success.
- Add regression coverage for empty/no-primary Ctrl-add with recursive import, primary remaining null, duplicate no-op, preservation of unsaved existing state, failure/stale-operation no-op, and the normal primary-present path as applicable to established test patterns.

## References
- Use the Vault audit contract `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` for #16/#17 and the corresponding external audit note. The owning plan is `work/active/TECSCDE-DT-EL実装/TECSCDE-DT-EL実装 — V0.2.1 実装計画 — 2026-11-12.md`.

## Ownership and safety
- The concise Stage 1 plan table calls this item a "notification"; this is incomplete shorthand. The external audit §17 lines 80–86 and internal audit §17 lines 172–188 both require the successful nullable-primary reference-add behavior above; treat those detailed specs as authoritative.
- Own only clear command/source-model behavior and Ctrl manual-add behavior plus directly relevant tests. Do not touch diagnostic/file-browser layout files or tests (Stage 1A ownership).
- Existing worktree has many unrelated dirty/untracked stage-4 changes; inspect any files you must edit first and preserve all unrelated hunks. Do not commit, stash, reset, clean, or revert anything. Do not spawn agents.
- Work in current workspace; use test-first development and run focused tests. Report exact changed paths and commands/results. Write full report to `.superpowers/sdd/v021-stage1/task-1b-report.md`.

# Stage 1B report — audit 16 and 17

Status: implementation and focused regression verification complete. Combined acceptance check remains with the lead after Stage 1A finishes. No commits, staging, stash, reset, revert, or cleanup performed.

## Contract followed

- Audit 16: clearing removes the primary source's cells, dependent joins, source template and type definitions, while retaining reference models, original source templates/text, source order, and saved checkpoints. The replacement anonymous primary has a clean baseline; edited references remain dirty. Cancellation preserves the document and dirty state.
- Audit 17: the initial task brief requested preserving rejection with a notification. Both Vault audit notes instead require allowing Ctrl-add with a null primary. This discrepancy was escalated, and the lead relayed the root's ruling to follow the Vault contract. The implemented behavior allows adding references to new/cleared diagrams without promoting a reference to primary.
- Sources: `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md`, audit 16 and 17; `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md`, audit 16 and 17.

## Changed paths

- `src/renderer/app/file-actions.ts`: preserve reference model/template state on clear; nullable-primary manual add; retain source templates to avoid serialization/reparse whitespace accumulation; keep discovered header types; abort unresolved recursive additions before applying state.
- `src/renderer/app/store.ts`: add `clearPrimaryDocument`, preserving reference checkpoints while resetting only the new primary baseline and invalidating old save tickets. Existing Stage 4 hunks were inspected and preserved.
- `src/renderer/app/import-resolution.ts`: accept a nullable primary for manual resolution; use the actual added file as the initial source context; carry the manually added file's tool_info through its recursive imports and C-header preprocessing. Existing normal-open context behavior remains the default.
- `tests/renderer/stage1-source-actions.test.ts`: 10 regression tests covering both audit items.
- `.superpowers/sdd/v021-stage1/task-1b-report.md`: this report.

No Stage 1A diagnostics/file-browser layout files or tests were edited. Shared pre-existing dirty work was retained.

## Verification

Test-first failures were observed before each production change:

- Reference cells/templates were absent after clear; the first assertion failed on the retained unsaved `count = 42` edit.
- Null-primary manual add left the reference set unchanged.
- Unresolved recursive imports partially changed the document/session before the guard was added.
- Added-file `tool_info.import_path` was ignored (`["."]` instead of `["includes"]`).
- C-header-derived signature validity was false for the first null-primary reference before preserving discovered C declarations.

Final focused command:

```text
npx vitest run tests/renderer/stage1-source-actions.test.ts tests/renderer/stage0-save-load.test.ts tests/renderer/import-resolution.test.ts tests/renderer/stage3-import-resolution.test.ts tests/renderer/shell.dom.test.ts tests/renderer/port-type-resolution.test.ts
```

Result: exit 0; 6 test files passed, 157 tests passed.

The new coverage proves byte-for-byte original reference template retention, identical serialized reference body before/after clear, unsaved attributes and dirty checkpoints retained, later reference save writes the retained body, cancelled clear unchanged, no-reference clear clean, reference-internal joins retained and removed-primary joins disconnected consistently, anonymous-primary cells/dirty state retained during add, determined-primary add retained, duplicate aliases and stale additions no-op, recursive import failure no-op, added-source parent/tool_info used, and C-header types retained.

`git diff --check`: exit 0. Git emitted LF-to-CRLF conversion notices for the shared worktree; no whitespace errors were reported.

`npm run check`: attempted before the lead's instruction to defer the combined check. Exit 1 in nested `build:renderer` script because `cmd.exe` could not find `npm` (`'npm' is not recognized as an internal or external command`). It did not reach typecheck/build/test/depcruise validation. The lead was notified; use the npm shim directory on PATH or direct Node-hosted CLIs for the combined check.

## Review notes and limits

- No notification-only behavior was implemented for null-primary Ctrl-add, following the explicit ruling above.
- The loader receives a transient empty key for the anonymous in-memory primary; it is removed from the resulting source templates/order and never enters saved session paths. Tests verify primary remains null and anonymous cell ownership is retained.
- Clearing invalidates pending save tickets by advancing document epoch, while preserving reference save baselines. Session snapshots contain paths/roles/order only; unsaved reference bodies remain in memory rather than becoming restart recovery data.
- Focused tests are green; the lead still needs the combined project acceptance check against the final Stage 1A + Stage 1B workspace.

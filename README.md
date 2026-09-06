# tecscde-dt-el

TECSCDE desktop app, Electron-specific implementation, per
[TECSCDE-DT-EL内部仕様](../../0-MD-2/_ARCHIVE/ObsidianVault2/0-MD-2/work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様.md)
(design alternative alongside `tecscde` (JS, browser) and `tecscde-ts` (TS classes, browser)).

## What this is

The internal spec's own recommended first implementation unit (chapter 11.4):

1. **Model + CDL parser/serializer round trip** — ported verbatim from `tecscde-ts`
   (`src/renderer/model/`, `src/renderer/cdl/`, `src/renderer/diagnostics/`), since the
   spec declares these modules identical between the two designs (chapters 3, 5, 6, 8).
2. **The IPC gateway plumbing, verified before any UI** — `FileService`/`TecsgenRunner`
   (main process) → `ipc.ts` → `preload/index.ts` (`contextBridge.exposeInMainWorld`) →
   `FileGateway`/`TecsgenGateway`/`ClipboardGateway` (renderer). This is the part the spec
   calls out as the new risk unique to this document (chapter 11.4 item 2): a
   `contextIsolation`/`sandbox` misconfiguration surfaces late if UI work happens first.

## Directory structure (per chapter 10)

```
src/
  main/       — FileService (dialog+fs), TecsgenRunner (child_process), ipc.ts, index.ts
  preload/    — contextBridge.exposeInMainWorld('tecscde', ...)
  renderer/
    model/, cdl/, diagnostics/   — ported from tecscde-ts, unchanged
    gateways/                     — renderer-side IPC proxies
  shared/     — types shared across all three processes (no runtime code)
```

## Commands

```
npm test          # vitest — 29 tests across model/cdl (ported) + main/preload/renderer (new)
npm run build     # type-check renderer, compile main+preload to dist/
npm run depcruise # enforce renderer ↛ electron / main ↛ renderer (chapter 10.1)
npm run check     # all three
```

## What's verified vs. not

- ✅ Model + CDL parser/serializer round trip (ported tests, still passing).
- ✅ `FileService` (atomic write, dialog cancel paths) and `TecsgenRunner` (ENOENT,
  non-zero exit) against real fs / mocked `child_process`.
- ✅ The full IPC *contract* (channel names, argument shapes) between `preload`,
  `main/ipc.ts`, and the renderer gateways — verified with `electron` mocked out.
- ❌ **Not verified**: an actual `electron .` launch. This dev environment has no
  display, and `electron`'s postinstall (which downloads the Electron binary) was
  blocked by the local install-scripts allowlist. The real `contextBridge` isolation
  behavior, `sandbox: true` compatibility (open question, spec 11.2 #1), and the
  renderer's actual bundling/loading are unverified.
- ❌ Chapters 4 (Copy/Paste/Cut clipboard commands), 5–6 (rendering/view state, verbatim
  from `tecscde-ts` but not yet ported), 7.4 (startup file-open wiring beyond the
  `FileService.openPath` method), 9.4 (`TecsgenResultParser`), and the UI shell (module G)
  are not implemented yet — see the corresponding chapters and
  `[[work/active/TECSCDE-DT-EL実装]]` for the current state.

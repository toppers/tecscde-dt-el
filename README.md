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
npm test          # vitest — 279 tests across model/cdl (ported) + main/preload/renderer
npm run build     # type-check renderer, compile main+preload to dist/
npm run depcruise # enforce renderer ↛ electron / main ↛ renderer (chapter 10.1)
npm run check     # all three
npm run forge:package # electron-forge package (asar, no installer)
npm run forge:make    # electron-forge make (Squirrel .exe installer, Windows only)
```

## What's verified vs. not

- ✅ Model + CDL parser/serializer round trip (ported tests, still passing).
- ✅ `FileService` (atomic write, dialog cancel paths) and `TecsgenRunner` (ENOENT,
  non-zero exit) against real fs / mocked `child_process`.
- ✅ The full IPC *contract* (channel names, argument shapes) between `preload`,
  `main/ipc.ts`, and the renderer gateways — verified with `electron` mocked out.
- ✅ **A real `electron .` launch**, verified interactively across multiple rounds
  (2026-09-08 through 2026-09-21): `contextBridge` isolation with `sandbox: false`
  (spec 11.2 #1, decided), preload ESM loading, renderer bundling/loading, and
  post-package (asar'd) startup all confirmed working on the actual machine.
- ✅ Chapters 4 (Copy/Paste/Cut clipboard commands), 5–6 (rendering/view state), 7
  (file I/O incl. the file browser, chapters 7B/7C/7D/7E), 8 (diagnostics), 9
  (tecsgen integration incl. `TecsgenResultParser` and `CdeclExtractor`), and the UI
  shell (module G) are implemented — see `[[work/active/TECSCDE-DT-EL実装]]` for the
  detailed progress log.
- ❌ Not yet implemented: code signing (installer is unsigned, triggers Windows
  SmartScreen) and macOS/Linux packaging — both still open per spec 11.2 #2, see
  `[[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 11 未決事項と実装単位案]]`.

## Installing / Updating

Windows only, for now (see "What's verified vs. not" above).

1. Download the latest `Setup.exe` from this repository's
   [Releases](https://github.com/toppers/tecscde-dt-el/releases) page and run it.
   The installer is unsigned, so Windows SmartScreen will warn before running it
   ("More info" → "Run anyway").
2. After installing, the app checks for updates automatically via
   `update-electron-app` (backed by `update.electronjs.org`, reading this
   repository's GitHub Releases) and applies them on the next restart — no manual
   redownload needed for subsequent versions.

Release automation (`.github/workflows/release.yml`) builds and publishes a new
release whenever a `v*` tag is pushed; see
`[[work/active/tecs/TECSCDE-DT-EL 配布アーキテクチャ決定]]` for the design.

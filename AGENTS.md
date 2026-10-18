`om_MCP.md` を読み込んで、指示に従って

## What this is

`tecscde-dt-el` is the Electron desktop implementation of TECSCDE (a TECS cell/join diagram
editor), built per an external "TECSCDE-DT-EL内部仕様" (internal spec) document referenced
throughout the code as `[[TECSCDE-DT-EL内部仕様]]` with chapter/section numbers (e.g. 第4章4.1節).
It is a design alternative alongside `tecscde` (JS, browser) and `tecscde-ts` (TS classes,
browser) — the model, CDL parser/serializer, and diagnostics modules are ported verbatim from
`tecscde-ts` since the spec declares them identical between designs.

When a comment cites a chapter/section number, treat it as a pointer into that external spec
document (not present in this repo) explaining *why* the code is shaped that way — useful
context if you need to understand a non-obvious design choice, but not something you can open
locally.

## Commands

```
npm run build           # typecheck renderer, then build:renderer + build:main
npm run build:renderer  # typecheck (tsconfig.renderer.json) + esbuild bundle → dist/renderer/
npm run build:main      # tsc -p tsconfig.main.json → dist/ (main + preload + shared)
npm run dev:renderer    # esbuild --watch for the renderer bundle
npm test                # vitest run (single run)
npm run test:watch      # vitest watch mode
npm run depcruise       # dependency-cruiser — enforces the process-boundary rules below
npm run check           # build + test + depcruise, run this before considering work done
npm start               # build then `electron .`
```

Run a single test file: `npx vitest run tests/renderer/commands.test.ts`
Run tests matching a name: `npx vitest run -t "some test name"`

`vitest.config.ts` only registers `tests/setup.ts`, which awaits the async WASM CDL grammar init
before any parsing test runs. Renderer tests run under `happy-dom` where DOM APIs are needed (see
`tests/renderer/shell.dom.test.ts`); `tests/perf/*.bench.test.ts` holds parser benchmarks.

Packaging: `npm run forge:package` / `forge:make` (Windows-only Squirrel installer; set
`FORGE_OUT_DIR` to redirect output). `.github/workflows/release.yml` publishes on `v*` tags and
pins Node 22 — `@electron/packager` hangs on newer Node.

## Process boundaries (enforced by `npm run depcruise`)

This is the architectural rule most likely to bite you. `.dependency-cruiser.cjs` mechanically
forbids:

- `src/renderer/**` importing `electron` (or, transitively, any Node/Electron API — fs,
  child_process, dialog, clipboard, etc.) directly. The renderer runs with
  `contextIsolation: true`, `nodeIntegration: false`, and must go through
  `window.tecscde.*` (exposed by `preload/index.mts` via `contextBridge`) instead.
- `src/main/**` importing anything under `src/renderer/**` (main has no DOM).

`src/shared/**` is type-only and exempt — it's the one module both sides may import.

Concretely: if you need a new capability that touches the filesystem, `tecsgen`, or the OS
clipboard, add it to `src/shared/ipc-types.ts` (the `TecscdeApi` interface), implement it in
`src/main/` (`FileService`/`TecsgenRunner`), wire it through `src/main/ipc.ts` and
`src/preload/index.mts`, and expose it to the renderer via a new/extended gateway in
`src/renderer/gateways/`. Never reach for `electron` or Node built-ins directly from
`src/renderer/`.

## Renderer architecture

`AppStore` (`src/renderer/app/store.ts`) is the central pub/sub store for the whole renderer —
it owns `History` (undo/redo), `ViewState`, `SelectionState`, input mode, the active file path,
the dirty marker, and diagnostics, all as immutable values swapped on update with
`notify()`-based subscription. `AppShell` (`src/renderer/app/shell.ts`) is the DOM entry point:
it wires real DOM elements (toolbar, `<svg>`, status bar) to `SvgRenderer`/`GestureController`
(rendering + hit-testing), `AppStore`, and a set of panel views (`palette.ts`,
`property-panel.ts`, `search-box.ts`, `navigator-panel.ts`, `diagnostics-panel.ts`), each of
which owns its own DOM wiring and rendering.

Key subsystems, mostly ported verbatim from `tecscde-ts`:
- `model/` — the document model (`TecscdeDocument`, `Cell`, `Join`, `Port`, ids, invariants).
- `cdl/` — CDL (the file format) lexer/parser/serializer and document builder.
- `diagnostics/` — `DiagnosticsCollector`, integrity checks (`checkIntegrity`), and
  `TecsgenResultParser` (parses tecsgen stdout/stderr into diagnostics).
- `render/` — `SvgRenderer`, `GestureController` (pointer/drag FSM), `HitTester`.
- `view-state/` — pan/zoom/grid state, navigator, search.
- `commands/` — the edit-history mechanism (see below).

### Command/undo-redo design

`Command` (`src/renderer/commands/command.ts`) is deliberately **not** invertible: subclasses
implement only `apply(doc) → doc`, never an `invert()`. Undo/redo works by replaying the `past`
command list from scratch (`history.ts`), not by applying inverse operations — this was a
deliberate decision to avoid a class of bugs where the inverse operation is implemented
incorrectly and only breaks in the undo direction. When adding a new command, don't add an
invert path; make `apply()` idempotent-safe for replay and let a no-op condition (e.g. target no
longer exists) silently return `doc` unchanged rather than throwing.

`CopyCommand` is a special case: it doesn't go through `store.dispatch()` (no history entry) —
`copySelection()` calls `.apply()` directly. `cutSelection()` writes to the OS clipboard once,
outside `CutCommand.apply()`, specifically because `dispatch()`/`history.commit()` may replay
`apply()` multiple times.

## Main process

`src/main/index.ts` creates the `BrowserWindow` with `contextIsolation: true`,
`nodeIntegration: false`, **`sandbox: false`**. The `sandbox: false` is required because preload
is written as ESM (`.mts` → `.mjs`), and Electron's sandboxed preload cannot use ESM `import`.
`FileService` (dialog + fs, atomic writes) and `TecsgenRunner` (spawns the external `tecsgen`
tool via `child_process`, plus a C preprocessor step) are instantiated per-window and registered
as `ipcMain.handle` channels in `ipc.ts`. On startup, after `did-finish-load`, main sends a
one-time `app:bootstrap` IPC message with the initial document (from argv/file-association, or
`public/samples` as a fallback) — the renderer consumes it via `onBootstrap()`.

## tecsgen integration and plugin-generated celltypes

Opening a CDL runs `tecsgen` (via `TecsgenRunner`) with a temporary `-g` directory; every `.cdl`
it generates is loaded as type definitions, but generated cells and temp paths are excluded from
the diagram, saved CDL, and session references. Opening a `.tecsgen-opts` file reuses its original
command-line options (including plugin library paths). `src/renderer/app/import-resolution.ts`
orchestrates recursive `import`/`import_C` resolution on the renderer side (parsing stays in
`cdl/`, file I/O goes through `FileGateway.resolveImports()`).

`tecsgen` is looked up on `PATH`; override with `TECSGEN_COMMAND` (e.g. `ruby "C:/path/to/tecsgen.rb"`).
The C preprocessor step defaults to `gcc -E -DTECSGEN`. Missing tecsgen is non-fatal: plain CDL
still opens and unresolved generated types remain as diagnostic warnings (`W-PLUGIN-TYPE-LOAD`).

## Persistence and logging (main)

`app-settings.ts` persists window-independent settings (file-browser root, `lastSession` file set)
under **Local** AppData on Windows (not Roaming, since paths are per-PC). `log-service.ts` appends
what the diagnostics panel shows to `tecscde-log-YYYYMMDD-HHMMSS.txt` (cwd first, falling back to
other dirs if unwritable; write failures never stop the app). Log files are gitignored.

## Renderer bundling

The renderer is bundled by `scripts/build-renderer.mjs` (esbuild) into a single
`dist/renderer/renderer.js` + `index.html`, with `public/samples` copied alongside for packaged
builds. `esbuild` is a build-time-only devDependency; the distributed app has no renderer
runtime dependencies.

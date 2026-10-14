# Repository Guidelines

## Project Structure & Module Organization

This is an Electron application written in TypeScript. `src/main/` owns the Electron process, `src/preload/` exposes the safe renderer API, `src/renderer/` contains the UI and TECS editing logic, and `src/shared/` holds cross-process types. Tests mirror these areas under `tests/main/`, `tests/preload/`, and `tests/renderer/`; shared fixtures are in `tests/fixtures/`. Static assets live in `public/`, build helpers in `scripts/`, and project documentation in `docs/`.

## Build, Test, and Development Commands

- `npm run build` type-checks and bundles the renderer, then compiles the main process.
- `npm start` builds and launches the Electron app.
- `npm run dev:renderer` watches and rebuilds renderer code during development.
- `npm test` runs the Vitest suite once; `npm run test:watch` reruns it while editing.
- `npm run check` runs the build, tests, and dependency checks. Run it before submitting a change.
- `npm run depcruise` checks dependencies in `src/` against `.dependency-cruiser.cjs`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, double-quoted strings, semicolons, and kebab-case filenames such as `tecsgen-gateway.ts`. Use `PascalCase` for types and classes and `camelCase` for functions and variables. TypeScript strict checks are enabled. There is no configured Prettier or ESLint command; keep edits consistent with nearby code. When changing an IPC operation, update its main handler, preload API, shared types, and renderer caller together.

## Testing Guidelines

Add focused `*.test.ts` files in the matching `tests/` area, and update existing tests when behavior changes. Vitest configuration is in `vitest.config.ts`, with common setup in `tests/setup.ts`. No coverage percentage is configured; demonstrate the changed behavior with meaningful assertions and run `npm run check`.

## Commit & Pull Request Guidelines

Recent commits use concise subjects, sometimes with prefixes such as `feat:`, `fix(cdl):`, or `docs:`. Describe the change in an imperative subject and keep each commit focused. In a pull request, explain the behavior and motivation, list verification commands, link relevant issues, and include screenshots for visible UI changes.

# Agent Note: Electron profile snapshot and window e2e

Status: implemented

English | [中文](2026-08-14-electron-profile-snapshot-and-window-e2e.zh.md)

## Problem

The desktop lane closed PR3's assembly with two coverage gaps: the `electron` profile had no keyless snapshot pinning its headless composition (no `webServer`, IPC-carried connection, one transcript), and the shell window had no test proving what only a real renderer shows — resolved webPreferences, the mounted `#root` document, and the refused external navigation. An initial Playwright teardown also hung the suite for up to four minutes on Windows.

## Decision

The headless snapshot (`apps/electron/tests/electron-profile.snapshot.ts` plus the `fixtures/electron-profile/` fixture) boots the real `electron` profile through `runProfile` in a plain-Node subprocess, with the `electron` builtin replaced by a fixture module through `module.registerHooks`: the stub exposes exactly the surface the tree's two desktop rows import (`ipcMain`, `dialog`, `BrowserWindow`), so any other `electron` import fails the link step loudly. The fixture asserts the boots settle with no `webServer` service, `ctx.connection.assertCarried()` holds, the three `dsh:*` IPC channels are registered, one `/api/host.describe` request round-trips the stubbed carrier handler, and prints one JSON line the snapshot tokenizes (`cwd` only) like its `apps/web` siblings.

The window e2e (`apps/electron/tests/window.e2e.ts`, vitest web lane) launches the built app through Playwright `_electron` under a temp `$DSH_HOME` and pins `contextIsolation`/`sandbox`/`nodeIntegration: false` from `getLastWebPreferences()`, the `dsh://app/` URL, a non-empty `#root`, `window.__DSH_BOOT__`, and that a refused `window.open('https://example.com')` leaves `document.location.origin` on `dsh://app`. The URL is compared whole because Node's WHATWG parser gives custom schemes an opaque origin (`"null"`), while Chromium's `document.location.origin` for the registered standard scheme does read `dsh://app` — the two origin notions disagree, so each side asserts its own.

Teardown closes the page before the app. Quitting app-first leaves the renderer alive through the whole tree dispose; it then retries its `/plugins/*/client.js` fetches in a loop against the disposed `dsh://` handler (which dereferences `ctx.clientModules` after dispose and throws `TypeError`), and that retry storm delays Electron process exit by anywhere from seconds to minutes on Windows. Closing the window first is the user quit path (`window-all-closed` → quit → dispose with no live renderer) and finishes in seconds. The committed `--dsh-smoke` flag stays a local automation gate (boot graph, bridge, carrier, exit code); the headless profile snapshot is the CI signal, and the e2e adds only what a real window proves and self-skips on display-less hosts or `DSH_ELECTRON_E2E=0`.

## Consequences

The e2e owns building the desktop shell in its `beforeAll` (the web lane builds lib and web dist but not `apps/electron`), so a display-capable machine running `test:web:built` directly still passes; a missing web dist fails loud. Vitest 4 honors a per-hook timeout argument over the config `hookTimeout` (verified by probe), so the `beforeAll`'s declared 180 s stays effective for a cold `tsc -b` while the web lane's 120 s config default covers everything else. The snapshot's fixture runs in both `src` (tsx) and `lib` (plain-Node type-stripped) modes because its registration is unconditional in `vitest.snapshot.config.ts`, matching the `apps/cli` suites.

One product wart is now visible and left as a follow-up: the `dsh://` protocol handler keeps dereferencing `ctx.clientModules` after the tree disposes, so late renderer requests surface as unhandled `TypeError`s instead of an answered 503; no user-visible quit path hits it (users close the window first), but an automation client calling `app.quit()` with the window open will see the noise.

## Alternatives considered

**Register the e2e under Playwright's own test runner, as the plan sketched.** The repo's browser e2e all run under vitest with `fileParallelism: false`; a second runner would add a config, a lockfile surface, and a CI lane for one file.

**Wait on `page.url()` polling or `did-finish-load` for the navigation lock.** `waitForURL('dsh://app/')` is the built-in equivalent and needs no custom predicate; an origin-based predicate can never match because Node-side `URL.origin` is opaque for `dsh://`.

**Raise `hookTimeout` in `vitest.web.config.ts`.** The observed `Hook timed out in 120000ms` was the undeclared `afterAll` waiting out the teardown retry storm, not an ineffective per-hook argument; fixing teardown order removed the wait.

## Verification

`pnpm exec vitest run --config vitest.snapshot.config.ts apps/electron/tests/electron-profile.snapshot.ts` passes twice with identical inline-snapshot output (determinism); `pnpm exec vitest run --config vitest.web.config.ts apps/electron/tests/window.e2e.ts` passes repeatedly in single-digit seconds on this display-capable Windows host; the full `pnpm run test:snapshot` suite shows the same pre-existing Windows failures with the new snapshot green; `pnpm run typecheck` and oxlint over `apps/electron` are clean.

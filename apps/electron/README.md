# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The dsh desktop shell: an Electron main/preload pair over the `electron` profile. The main process boots the profile with `runProfile` (the same launcher entry the CLI uses, exported as `@deepseek-ai/dsh/profile-boot`), registers the privileged `dsh://` protocol over the built web frontend dist, and opens one sandboxed window. Everything model- or session-facing rides the [`dsh-host-connection-electron`](../../packages/host/connection-electron/README.md) IPC carrier inside the booted tree — the protocol handler serves only pages, plugin client bundles, and the session-export download.

## Run

```sh
pnpm run build:lib && pnpm run build:web   # workspace packages + web dist (once, and after changes)
pnpm run dsh:electron                      # builds the app, then `electron .`
```

The window loads `dsh://app/`; `Ctrl+Shift+I` / `F12` opens DevTools. Navigation away from the `dsh://app` surface is refused, and so is every new window.

## `--dsh-smoke`

`electron . --dsh-smoke` replaces interactive lifetime with machine-checked assertions: the renderer must see the injected `window.__DSH_BOOT__` graph and the preload's `window.__DSH_IPC__` bridge, one request must cross the `dsh:fetch` IPC channel, and the booted profile must mount no `webServer` service. The process prints one `PASS`/`FAIL` line per assertion and exits 0 only when all pass; dialogs are suppressed so automation never blocks on a modal.

Two keyless test suites complement it: `apps/electron/tests/electron-profile.snapshot.ts` (`pnpm run test:snapshot`) boots the profile headless in plain Node with `electron` stubbed and pins one transcript, and `apps/electron/tests/window.e2e.ts` (`pnpm run test:web`, after the web dist build) drives the real window through Playwright — resolved `webPreferences`, the mounted `#root`, `window.__DSH_BOOT__`, and refused external navigation; it self-skips on display-less hosts.

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | App lifetime: profile boot, `dsh://` registration, window preferences, navigation locks, one-shot tree disposal. |
| `src/protocol.ts` | The `dsh://` request handler: dist files with the boot-graph injection, `/plugins/<id>/client.js[.map]` bundles, `/api/session.export` passthrough. |
| `src/preload.ts` | The renderer bridge — exactly the `window.__DSH_IPC__` shape `dsh-client-connection` reads. |
| `build-preload.mjs` | esbuild bundle of the preload into one classic CJS file (`preload/index.cjs`). |

## Window posture

The window runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`; the page's only privileged surface is the four-member IPC bridge. The preload is the sole wire endpoint, and `dsh://` is registered as a privileged scheme (`standard`, `secure`, `supportFetchAPI`, `stream`) before app ready.

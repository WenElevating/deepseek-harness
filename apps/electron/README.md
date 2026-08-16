# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The dsh desktop shell: an Electron main/preload pair over the `electron` profile. The main process boots the profile with `runProfile` (the same launcher entry the CLI uses, exported as `@deepseek-ai/dsh/profile-boot`), registers the privileged `dsh://` protocol over the built web frontend dist, and opens one sandboxed window. Everything model- or session-facing rides the [`dsh-host-connection-electron`](../../packages/host/connection-electron/README.md) IPC carrier inside the booted tree — the protocol handler serves only pages, plugin client bundles, and the session-export download.

## Run

```sh
pnpm run build:lib && pnpm run build:web   # workspace packages + web dist (once, and after changes)
pnpm run dsh:electron                      # builds the app, then `electron .`
pnpm run package:desktop                   # shareable portable win-x64 dir + zip under apps/electron/release
```

`package:desktop` (win32 host only) deploys the production closure with `pnpm deploy --prod --legacy --config.node-linker=hoisted`, repairs the runtime packages that deploy prunes (several workspace packages classify runtime imports as devDependencies), copies the prebuilt Electron runtime with the exe renamed to `DeepSeek Harness.exe`, patches its icon and version metadata with rcedit, and zips the result. The deployed `resources/app` is flat real files — no symlink store — so the zip extracts to a runnable copy; each recipient's first run initializes the `electron` profile under their own `$DSH_HOME` (`%USERPROFILE%\.dsh`).

The window loads `dsh://app/`; `Ctrl+Shift+I` / `F12` opens DevTools. Navigation away from the `dsh://app` surface is refused, and so is every new window.

## `--dsh-smoke`

`electron . --dsh-smoke` replaces interactive lifetime with machine-checked assertions: the renderer must see the injected `window.__DSH_BOOT__` graph, the preload's `window.__DSH_IPC__` bridge and `window.__DSH_WINDOW__` caption bridge, one request must cross the `dsh:fetch` IPC channel, and the booted profile must mount no `webServer` service. The process prints one `PASS`/`FAIL` line per assertion and exits 0 only when all pass; dialogs are suppressed so automation never blocks on a modal.

Two keyless test suites complement it: `apps/electron/tests/electron-profile.snapshot.ts` (`pnpm run test:snapshot`) boots the profile headless in plain Node with `electron` stubbed and pins one transcript, and `apps/electron/tests/window.e2e.ts` (`pnpm run test:web`, after the web dist build) drives the real window through Playwright — resolved `webPreferences`, the mounted `#root`, `window.__DSH_BOOT__`, refused external navigation, the frameless caption, and one unscoped out-of-tree plugin installed into the isolated home through `dsh plugin add` (proving the profile-anchored import retry covers any bare package name, not just `@deepseek-ai/*`); it self-skips on display-less hosts.

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | App lifetime: profile boot, `dsh://` registration, window preferences, navigation locks, one-shot tree disposal. |
| `src/protocol.ts` | The `dsh://` request handler: dist files with the boot-graph injection, `/plugins/<id>/client.js[.map]` bundles, `/api/session.export` passthrough. |
| `src/preload.ts` | The renderer bridges — exactly the `window.__DSH_IPC__` shape `dsh-client-connection` reads and the `window.__DSH_WINDOW__` shape `dsh-client-ui-layout`'s caption band reads. |
| `build-preload.mjs` | esbuild bundle of the preload into one classic CJS file (`preload/index.cjs`). |
| `build/icon.svg` · `build/icon.png` | Window/taskbar icon: the bare whale mark (from `apps/web/public/favicon.svg`) in ink on transparency, matching the in-app mark. The SVG is the source; the PNG is what `BrowserWindow` loads (Electron takes raster icons only). |

## Icon

The mark carries no tile, so it stays identical to the favicon and the UI logo; a static PNG cannot express the favicon's `prefers-color-scheme` flip, so the light-mode ink is fixed. Regenerate `build/icon.png` from the SVG with the installed Electron (no extra tooling): a hidden window draws `build/icon.svg` onto a 256×256 canvas and `toDataURL()` writes the PNG — `capturePage()` would composite the opaque page background into the corners. A packaging PR replaces this with an embedded `.ico` via electron-builder; until then the window icon covers the title bar and taskbar, and the page favicon rides `dsh://app/favicon.svg` from the dist.

## Window posture

The window is frameless (`frame: false`): the page itself is the caption — ui-layout's window band renders the drag region and the theme-matched minimize/maximize/close controls over the center and details columns, and the sidebar header drags its own column; all of it renders only when the preload injected the window bridge, so the browser build stays unchanged. The window still runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`; the page's only privileged surfaces are the two four-member bridges (`__DSH_IPC__`, `__DSH_WINDOW__`). The preload is the sole wire endpoint, and `dsh://` is registered as a privileged scheme (`standard`, `secure`, `supportFetchAPI`, `stream`) before app ready.

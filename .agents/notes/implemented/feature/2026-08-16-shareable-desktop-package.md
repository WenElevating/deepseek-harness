# Agent Note: Shareable desktop packaging without a bundler framework

Status: implemented

English | [中文](2026-08-16-shareable-desktop-package.zh.md)

## Problem

The desktop shell ran only from a source checkout (`pnpm run dsh:electron`); sharing it with someone without the repository meant nothing. A shareable build must carry the whole plugin closure and the web dist (the shell boots the `electron` profile from the recipient's own `$DSH_HOME` and heals `profiles/node_modules` from the shipped installation, like a checkout does), stay runnable after zip extraction, and keep the whale icon on the exe.

## Decision

`scripts/package-desktop.mjs` (`pnpm run package:desktop`, win32 host) produces a portable directory plus zip under `apps/electron/release` with no electron-builder/electron-forge dependency: the prebuilt Electron runtime from `node_modules/electron/dist` with its exe renamed to `DeepSeek Harness.exe` (icon and version metadata via rcedit, the one new devDependency), and the application at the classic `resources/app` position.

`resources/app` comes from `pnpm deploy --prod --legacy --config.node-linker=hoisted`. The hoisted linker yields flat real files with no `.pnpm` symlink store, so the zip extracts to a runnable copy anywhere; it is also the same single-cordis-instance layout profiles already use. The web dist needs no packaging special case: `@deepseek-ai/dsh-web-frontend` is a production dependency of the app whose `files` include `dist`, so `DIST_ROOT`'s `require.resolve` works unchanged inside the deployed closure.

## The repair pass

The first packaged boot failed with `ERR_MODULE_NOT_FOUND: @deepseek-ai/cordis-plugin-group` — `dsh-app-boot` (and 27 more packages across the closure) classify packages their built `lib/` imports at runtime as **devDependencies**. That is invisible in the workspace (dev deps of every package are always installed) and fatal under a `--prod` deploy. `repairClosure` walks every staged manifest's `dependencies`/`devDependencies`/`peerDependencies` and copies any missing `@deepseek-ai/*` name from the workspace (located by scanning `packages/`, `vendor/`, `apps/`, `native/` manifests — vendored peers like cosmokit resolve from no single anchor), iterating to a fixed point; a name that is not a workspace package fails loud.

## Alternatives considered

**electron-builder or electron-forge.** Rejected: both fight pnpm workspace-linked `node_modules`, and the profile system already owns its own deployment shape (`resources/app` + healed closure), leaving the frameworks nothing to add but weight and failure modes.

**Drop `--prod` instead of repairing.** Rejected: dependencies' own devDependencies stay excluded from a deploy regardless of the target's prod flag, so the same packages go missing either way.

**Reclassify the 28 packages' runtime imports as real dependencies.** The proper upstream fix, deliberately not bundled with this change: it touches 28 manifests and their consumers' expectations at once, while the repair pass keeps packaging self-contained and fails loud when the underlying classification changes under it.

## Testing

`--dsh-smoke` against the staged exe under an isolated `$DSH_HOME`: all five checks PASS, exit 0 — including the IPC carrier round-trip and the renderer boot graph inside the packaged layout.

## Deferred

- macOS/Linux packaging (the exe rename and rcedit steps are Windows-shaped).
- Installer and code signing; recipients will see a SmartScreen warning on first run of the unsigned exe.
- Trimming the shipped `node-pty` prebuilds for non-host platforms (~60 MB).

## Consequences

The build now shares as one 207 MB zip that runs anywhere after extraction, at the cost of a packaging-local repair pass standing in for per-package dependency classification debt: each new runtime import classified as a devDependency lands in the closure silently (the fixed-point walk picks it up) rather than failing a package test, so the pass must stay until that debt is paid. win32-x64 is the only shipped platform; every other platform decision is deferred with it.

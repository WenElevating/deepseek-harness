# Agent Note: Electron main plugin resolution and HMR degradation

Status: implemented

English | [中文](2026-08-14-electron-main-plugin-resolution.zh.md)

## Problem

The desktop shell (`apps/electron`) boots the `electron` profile through the same `runProfile` launcher the CLI uses, exported as `@deepseek-ai/dsh/profile-boot`. Under Electron's embedded Node, two plain-Node assumptions of that path fail: the vendored Loader cannot reach Node's internal ESM loader, and the vendored HMR service refuses to construct without it.

## Decision

Electron 39 main hides the internal ESM loader from `node-addon-require-builtin` (its realm probe finds no `GetAlignedPointerFromEmbedderData` symbol), so `ModuleLoader.fromInternal()` returns `undefined` and `EntryTree.import` falls back to importing plugin specifiers from the vendored loader's own package, where no workspace dependency resolves. The desktop main installs one process-global `module.registerHooks` resolve hook before boot: each failed `@deepseek-ai/` import is retried with the parent URL anchored at the booted profile's directory, whose parent-walk reaches both the profile's own `node_modules` and the launcher-maintained `$DSH_HOME/profiles/node_modules` flat fallback. That is the same resolution the internal-loader path provides under plain Node; the hook lives in `apps/electron/src/main.ts` and touches no vendored or shared package.

The watch-only HMR instance `runProfile` mounts for live `cordis.patch.yml` edits cannot exist in this environment: the vendored HMR constructor throws without the internal loader. `runProfile` now mounts the timer + watch-only HMR pair only when `ctx.loader.internal` is defined, warns through the tree logger when it is not, and skips the two `watchUserPatches` registrations (they require the HMR service). The desktop shell repeats the warning on its own console because no desktop row exports the tree logger. Desktop `cordis.patch.yml` edits apply on restart; plain-Node surfaces keep live reload unchanged.

## Consequences

Plugin resolution in the desktop main depends on the launcher-maintained flat fallback staying the resolution surface for in-box plugins; a future change that removes or relocates `$DSH_HOME/profiles/node_modules` must update the hook's anchor. The retry is scoped to failed `@deepseek-ai/` specifiers only, so the app's own dependency tree still resolves first for every import. Live patch-layer reload is unavailable on the desktop shell: profile `cordis.patch.yml` and `$DSH_HOME/cordis.patch.yml` edits require an app restart there, while every plain-Node surface keeps hot reload. The `--dsh-smoke` flag is committed as the machine-checked boot gate for automation and future e2e.

## Alternatives considered

**Patch the vendored Loader with an `import.meta.resolve` fallback.** Correct for Electron but changes resolution for every runtime, and the sync-procedure burden of a vendored modification is not justified while an app-owned hook suffices.

**Fake the `internal` field with a resolve-and-import shim.** The HMR service also uses internal APIs for module invalidation; a partial fake would construct services whose lifecycle behavior is untested under Electron.

**Ship `--expose-internals` to the Electron main.** The flag exposes `require('internal/…')` only in builds whose embedder data slots match plain Node; the addon probe already fails under Electron regardless of the flag.

## Verification

`electron . --dsh-smoke` boots the real profile and asserts the renderer saw `window.__DSH_BOOT__` and the four-member `window.__DSH_IPC__` bridge, that one request crossed the `dsh:fetch` IPC channel, and that no `webServer` service mounted; it exits nonzero on any failure. `apps/electron/tests/protocol.spec.ts` pins the `dsh://` handler (boot-graph injection order, MIME mapping, encoded traversal rejection, bundle and export routes).

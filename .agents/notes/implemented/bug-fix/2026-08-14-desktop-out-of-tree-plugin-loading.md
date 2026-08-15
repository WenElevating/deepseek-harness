# Agent Note: Two gaps that kept out-of-tree plugins out of the desktop shell

Status: implemented

English | [中文](2026-08-14-desktop-out-of-tree-plugin-loading.zh.md)

## Problem

A plugin installed through the documented out-of-tree flow ([publish tutorial](../../../../docs/user/develop/basic/publish.md): `dsh plugin --profile <name> add <package>`, any package name) failed to boot in the Electron desktop shell with `ERR_MODULE_NOT_FOUND`, while the same profile booted fine under the plain-Node CLI. Two independent defects stacked on that path:

1. **Resolution.** Electron's embedded Node cannot host the internal ESM loader, so the vendored Loader imports plugin specifiers anchored at its own package location — nothing pnpm linked into the profile is reachable from there. `installProfileResolutionRetry` in `apps/electron/src/main.ts` re-anchors failed imports at the booted profile's directory, but only for specifiers starting with `@deepseek-ai/`. In-box rows all carry that scope, so the gate was invisible until the first unscoped out-of-tree row arrived.
2. **Installation.** `initProfile` writes a `pnpm-workspace.yaml` into every profile (it carries the hoisted-linker settings pnpm ≥10 reads from there), which makes the profile a one-package pnpm workspace — and pnpm refuses manifest-mutating verbs inside a workspace root without `--workspace-root` (`ERR_PNPM_ADDING_TO_ROOT`). `dsh plugin add` therefore failed outright on a fresh profile; the affected user had hand-written their profile manifest and run pnpm themselves to get around it.

## Fix

- The retry hook now re-anchors **any bare package specifier** (`isBarePackageSpecifier`: not relative, not absolute, not `node:`, not `#imports`); everything else still fails as before. The retry can only rescue an import that was about to fail, so it cannot mask genuine app-code import errors — it may only resolve a name that genuinely exists in the profile installation, which is the documented plain-Node semantics the hook exists to reproduce.
- `runPlugin` injects `-w` for the root-checked verbs (`add`/`remove`/`update`/`unlink`) when and only when the profile carries a `pnpm-workspace.yaml` (`withWorkspaceRootFlag`); a profile without the file is a plain package root where the flag itself would fail. Unit-spec'd in `apps/cli/tests/plugin.spec.ts`.
- `window.e2e.ts` now installs a real unscoped fixture bundle into its isolated home through `dsh plugin add` before launch and asserts the fixture's `apply()` flag from the main process — the acceptance path for both fixes together.

## Why the e2e needed onboarding dismissal

The fresh isolated home always runs the two-step GUI onboarding (internal-testing notice, then the API-key dialog; both landed after this suite last ran green). Each step's modal mask intercepts every pointer event, which had nothing to do with the plugins work but broke the click-driving tests; `beforeAll` now takes the keyless "configure later" path through both dialogs.

## Why this shape

The retry-hook prefix gate was a proxy for "packages the installation owns", and the profile is exactly where *user-owned* packages live — the correct boundary is specifier *shape* (bare package name), not name *scope*. The `-w` injection keys on the workspace file's presence rather than always passing the flag, because the flag's own validity depends on that same fact.

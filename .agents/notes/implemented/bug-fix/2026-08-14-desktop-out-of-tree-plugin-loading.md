# Agent Note: Two gaps that kept out-of-tree plugins out of the desktop shell

Status: implemented

English | [中文](2026-08-14-desktop-out-of-tree-plugin-loading.zh.md)

## Problem

A plugin installed through the documented out-of-tree flow ([publish tutorial](../../../../docs/user/develop/basic/publish.md): `dsh plugin --profile <name> add <package>`, any package name) failed to boot in the Electron desktop shell with `ERR_MODULE_NOT_FOUND`, while the same profile booted fine under the plain-Node CLI. Two independent defects affect that path: Electron's embedded Node anchors failed plugin imports at its own package location, and `initProfile` makes every profile a one-package pnpm workspace whose manifest-mutating commands require `--workspace-root`.

## Decision

`installProfileResolutionRetry` in `apps/electron/src/main.ts` retries a failed bare package specifier from the booted profile directory. Relative and absolute paths, `node:` specifiers, and `#` imports are not retried, so the hook reproduces the profile's plain-Node package resolution without changing unrelated import failures.

`runPlugin` injects `-w` when the profile has `pnpm-workspace.yaml` and the pnpm command is one of `add`, `remove`, `update`, or `unlink`. `withWorkspaceRootFlag` scans raw pnpm arguments past recognized global options and their separate values, accepts `--option=value` forms, and preserves the original argument order. A profile without the workspace file receives no `-w` flag.

The Electron window E2E creates an isolated profile, installs an unscoped fixture bundle through `dsh plugin add`, and asserts the fixture's `apply()` flag from the main process. Its setup selects the keyless configure-later path through the internal-testing and API-key dialogs because their modal masks intercept pointer events during the browser-driven checks.

## Alternatives considered

**Retry only `@deepseek-ai/` specifiers.** Rejected because out-of-tree plugins may use any package name; the installation profile, not a package scope, identifies the resolution anchor.

**Always pass `-w` to pnpm.** Rejected because a profile without `pnpm-workspace.yaml` is a plain package root where `--workspace-root` is invalid.

**Assume the command is always `args[0]`.** Rejected because pnpm accepts global options before the command. The argument scanner skips known value-taking options so a value such as `add` in `--filter add` is not mistaken for the command.

## Consequences

Unscoped packages installed in a profile can load in the Electron shell, and fresh workspace profiles accept manifest-mutating plugin commands with the recognized pnpm global options before the command. Plain package profiles retain their existing invocation semantics. Relative path specs still resolve against the user's invoking directory, while all other pnpm arguments remain unchanged.

The CLI unit suite covers verb-first calls, global options with separate values, equals-form options, non-mutating commands, and profiles without a workspace file. The Electron E2E covers the assembled profile path and the unscoped fixture. The resolution retry remains limited to imports that already failed from the loader's default anchor.

# Agent Note: The electron profile must restate both faces of the directory-picker interaction

Status: implemented

English | [中文](2026-08-14-electron-profile-directory-picker-surface-pair.zh.md)

## Problem

The collapsed desktop sidebar showed a blank 36px cell above the search icon, and the wide sidebar offered no add-workspace action. Both symptoms came from the unoccupied `sidebar.workspaces.directoryFlow` and `conversation.hero.workspace.directoryFlow` holes: `WorkspaceBrowser` and `WorkspacePicker` withdrew the add affordance while the rail's always-mounted section-header row kept its geometry (`directoryFlowAvailable === false`).

The adaptive `directory-picker` host row mounts the directory interaction's backend and client surface as one pair. The Electron profile needs the Electron host dialog backend, so its bundle patch disables that adaptive row and must restate both faces explicitly.

## Decision

`packages/bundle/electron-app/cordis.patch.yml` disables the adaptive `directory-picker` row and inserts `directory-picker-electron` together with `ui-directory-picker-native`. The bundle declares the native surface as a dependency. The surface is carrier-neutral: it calls `workspaces.pickDirectory()` over the IPC carrier mounted by the Electron profile.

The composition test asserts that the adaptive row is disabled, the Electron host and native surface rows are present and enabled, and the IPC connection row remains active.

## Alternatives considered

**Keep the adaptive `directory-picker` row.** Rejected because the Electron profile must replace its generic host backend with the native Electron dialog implementation.

**Insert only `directory-picker-electron`.** Rejected because the adaptive row owns the client surface as well as the backend; omitting the surface leaves both directory-flow holes unoccupied.

**Create a desktop-specific client surface.** Rejected because `ui-directory-picker-native` is carrier-neutral and already drives the shared `workspaces.pickDirectory()` capability over IPC.

## Consequences

The Electron profile provides the directory-picker backend and client surface as a complete pair, so the collapsed rail and wide sidebar retain their add-workspace affordances without a web server. The bundle carries an explicit dependency on the surface, and the composition test fails if either face is removed or disabled.

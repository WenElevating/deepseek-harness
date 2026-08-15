# Agent Note: The electron profile must restate both faces of the directory-picker interaction

Status: implemented

English | [中文](2026-08-14-electron-profile-directory-picker-surface-pair.zh.md)

## Problem

The collapsed desktop sidebar showed a blank 36px cell above the search icon, and the wide sidebar offered no add-workspace action at all. Both symptoms had one cause: the `sidebar.workspaces.directoryFlow` and `conversation.hero.workspace.directoryFlow` holes sat unoccupied, so `WorkspaceBrowser`/`WorkspacePicker` withdrew the add affordance while the rail's always-mounted section-header row kept its geometry (`directoryFlowAvailable === false`).

The hole is occupied by a client surface plugin (`dsh-client-ui-directory-picker-native` / `-browse`), and in the shipped web profile that surface arrives indirectly: the adaptive `directory-picker` host row ([dsh-host-directory-picker-auto](../../../../packages/host/directory-picker-auto/README.md)) resolves the interaction at boot and mounts **backend and surface as one pair** of loader entries. The `dsh-electron-app` bundle patch disables that adaptive row and re-inserted only the Electron **host** backend (`dsh-host-directory-picker-electron`). Disabling the adaptive row silently dropped the client surface with it, and nothing in the patch documented that the row owned two faces — the bundle README even said the desktop surface "keeps every `dsh.client` browser row mounted", which was true of the web-app layer's roster and irrelevant to the surface the chooser mounts at runtime.

## Fix

`packages/bundle/electron-app/cordis.patch.yml` now inserts `ui-directory-picker-native` (declared as a bundle dependency) next to the Electron host backend, restating the pair the disabled adaptive row used to mount. The surface is carrier-neutral — it drives `workspaces.pickDirectory()` over whatever carrier the composition mounts, here the IPC carrier — so no desktop-specific client code is needed. The composition spec now asserts the surface row exists and is enabled, so dropping one face of a pair again fails a test.

## Why this shape

Any bundle that disables an auto-chooser row inherits the obligation to restate **everything that row mounts dynamically**, not just the plugin named in the row. A row's runtime mount surface (loader entries it creates) is invisible to the patch author's mental model of "what does this row give me", which is exactly why the README sentence about `dsh.client` rows did not catch it: the surface was never a roster row.

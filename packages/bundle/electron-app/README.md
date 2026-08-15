# `@deepseek-ai/dsh-electron-app`

English | [中文](README.zh.md)

The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md) as the third layer of the `electron` profile template: it disables the HTTP carrier family ([`dsh-host-webserver`](../../host/webserver/README.md) and the reload chain [`dsh-client-hmr`](../../client/hmr/README.md), idle dead weight with no HTTP surface to serve) and the adaptive [`directory-picker`](../../host/directory-picker-auto/README.md) row, inserts the Electron replacements — [`dsh-host-directory-picker-electron`](../../host/directory-picker-electron/README.md) (the harness runs inside the Electron main process, so the OS dialog needs no cross-process hop), the paired [`dsh-client-ui-directory-picker-native`](../../client/ui-directory-picker-native/README.md) surface (disabling the adaptive row drops both faces of its resolved interaction, and without this occupant the sidebar and hero offer no add-workspace action), and [`dsh-host-connection-electron`](../../host/connection-electron/README.md) (the IPC carrier that claims the carrier-neutral `connection` host half and binds it to `ipcMain`/`webContents`) — and keeps every `dsh.client` browser row mounted, since the desktop shell loads the same frontend through Electron's renderer. The package has no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

The `web-runtime` row stays mounted, configured to `printUrl: false, surfaceContext: false`: the web-app `connection` row injects its `webRuntime` service, and a Loader patch cannot re-target a row's `inject`, so disabling the row would strand the browser roster's trust fence. With `printUrl` false it prints no URL line — the desktop shell has no canonical URL — and with `surfaceContext` false it registers no web-surface prompt section and no `DSH_WEB_URL` bash variable; with no webServer row mounted it still provides `webRuntime` as the empty trust snapshot, so the renderer's `dsh:fetch` bridge needs no HTTP trust at all.

## Model Experience

Indirectly, through the composed rows: this bundle disables model-visible surfaces the web layer registers and mounts no model-visible text of its own.

#### KV Cache effect

None directly; each composed row's package owns its effect.

## Known Limitations and Deferred Work

- **A patch replaces whole row configs** — the `web-runtime` override drops `trustedHosts` along with the flags it changes, which is safe only because the schema default plus the empty no-server snapshot make the value irrelevant here; a future re-enable of the HTTP family must restate the full config.
- **No desktop launcher ships yet** — the `electron` profile initializes and composes, but the Electron main-process entry that mounts it arrives with the desktop shell; until then the profile boots like `web` minus the HTTP family.

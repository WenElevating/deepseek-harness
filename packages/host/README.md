# host/ — web-GUI host half

English | [中文](README.zh.md)

The host side of the dsh web GUI: the API gateway every client shape shares, the plain HTTP server it rides on, and the Electron IPC carrier of the desktop shell. The browser side lives in [`client/`](../client/README.md); the composed application is [`apps/cli`](../../apps/cli/README.md) booting the [`dsh-base` bundle](../bundle/base/cordis.patch.yml) serving [`apps/web`](../../apps/web/); the desktop shell is [`apps/electron`](../../apps/electron/README.md). All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`apiproxy/`](apiproxy/README.md) | Shared host API gateway and wire contract | `ctx.apiProxy` |
| [`webserver/`](webserver/README.md) | HTTP route carrier | `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.md) | SPA dist server on the webserver fallback seat | consumes `ctx.webServer` |
| [`connection-electron/`](connection-electron/README.md) | Electron IPC carrier for the Connection host service | claims `ctx.connection` |
| [`directory-picker/`](directory-picker/README.md) | Workspace-directory picking seam | `ctx.directoryPicker` |
| [`directory-picker-native/`](directory-picker-native/README.md) | Native directory-picker backend and browser interaction | registers `ctx.directoryPicker` |
| [`directory-picker-electron/`](directory-picker-electron/README.md) | Native directory-picker backend inside Electron main | registers `ctx.directoryPicker` |
| [`directory-picker-browse/`](directory-picker-browse/README.md) | In-app directory-browser backend and interaction | registers `ctx.directoryPicker` |
| [`directory-picker-auto/`](directory-picker-auto/README.md) | Host-adaptive picker composition | mounts a backend |
| [`plugin-inventory/`](plugin-inventory/README.md) | Read-only projection of current Loader entries | Remote `pluginInventory/list` |

`apiproxy` remains transport-independent; [`client/connection`](../client/connection/README.md) provides the carrier-neutral host half and mounts the HTTP carrier under a webServer, while [`connection-electron`](connection-electron/README.md) claims the same seat for the desktop shell ([carrier rules](../../.agents/notes/implemented/architecture/2026-08-15-electron-ipc-desktop-shell.md)). Picker implementations replace one another behind the shared seam.

The subsystem references: [web-server.md](../../docs/subsystems/web-server.md) and [workspace.md](../../docs/subsystems/workspace.md) (the picker seam).

# @deepseek-ai/dsh-host-directory-picker-electron

English | [中文](README.zh.md)

The **Electron backend** of the [directory-picker seam](../directory-picker/README.md): `ElectronDirectoryPicker` registers `ctx.directoryPicker` with the `native` capability from inside the Electron main process, so `pick(signal)` calls `dialog.showOpenDialog` directly — attached to the focused `BrowserWindow`, the first open window when none is focused, or windowless when none exists — with no cross-process hop. Each pick resolves the chosen absolute path (`null` on cancel or on a pathless close). The harness runs in the main process, and the `electron` peer dependency is satisfied by that host process. The desktop shell composes this backend with one electron-profile row instead of [`-native`](../directory-picker-native/README.md): both register the `native` capability, so exactly one backend row may load — a second throws, cordis' standard duplicate-service behavior.

## Model Experience

None, as the backend serves the desktop shell's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Abort cannot close the dialog** — Electron offers no API to dismiss a modal `showOpenDialog`, so an abort that lands while the dialog is open discards the late answer (the pick resolves `null`) instead of closing it; a dismissible picker would need a renderer-side custom dialog.

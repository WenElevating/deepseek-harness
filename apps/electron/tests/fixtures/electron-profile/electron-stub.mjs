/**
 * Headless stand-in for the `electron` builtin, served to every `electron`
 * import by the smoke fixture's resolve hook. It implements exactly the
 * surface the two desktop-only rows use (`ipcMain` for the IPC carrier,
 * `dialog`/`BrowserWindow` for the directory picker); anything else the tree
 * might import from `electron` fails the link step loudly instead of silently
 * no-op'ing under `undefined`.
 */

/** Registered `ipcMain` handlers, keyed by channel; the smoke's assertion surface. */
export const ipcHandlers = new Map()

export const ipcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler)
  },
  removeHandler(channel) {
    ipcHandlers.delete(channel)
  },
}

export const dialog = {
  /** A headless boot must never open a modal; a stray pick fails the run rather than hanging it. */
  async showOpenDialog() {
    throw new Error('electron-stub: dialog.showOpenDialog called in a headless electron profile smoke')
  },
}

export const BrowserWindow = {
  getFocusedWindow() {
    return undefined
  },
  getAllWindows() {
    return []
  },
}

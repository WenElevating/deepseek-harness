/**
 * Electron backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `native` capability via the host process's own dialog — the harness
 * runs inside the Electron main process, so no cross-process hop exists.
 * @module @deepseek-ai/dsh-host-directory-picker-electron
 */
import { BrowserWindow, dialog } from 'electron'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'

/**
 * Read the signal's abort flag through a call boundary: TypeScript keeps an
 * earlier `signal.aborted` check narrowed across the dialog await, and the
 * flag can flip while the dialog is open.
 * @param signal - the picker call's abort signal.
 * @returns whether the signal has aborted.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** The `ctx.directoryPicker` Electron implementation. */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: async (signal: AbortSignal): Promise<string | null> => {
      // Electron dialogs cannot be dismissed programmatically, so a pick that
      // starts aborted must never open one: there would be no way to end it.
      if (isAborted(signal)) return null
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = { properties: ['openDirectory' as const] }
      const result = window === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options)
      // A caller abort that landed while the dialog was open discards the
      // late answer.
      if (isAborted(signal)) return null
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    },
  }

  /** The native interaction capability (stable object per service life). */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}

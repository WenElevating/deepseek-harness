/** The Electron picker drives dialog.showOpenDialog and honors abort. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DirectoryPickerNativeCapability } from '@deepseek-ai/dsh-host-directory-picker'

const showOpenDialog = vi.fn()
const getFocusedWindow = vi.fn()
const getAllWindows = vi.fn()
vi.mock('electron', () => ({
  // The forwarders return the vi.fn() doubles' `any`; typed as unknown they
  // stay opaque at this boundary (the plugin narrows through electron's own types).
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) as Promise<unknown> },
  BrowserWindow: {
    getFocusedWindow: () => getFocusedWindow() as unknown,
    getAllWindows: () => getAllWindows() as unknown[],
  },
}))

import ElectronDirectoryPicker from '../src/index.ts'

beforeEach(() => {
  showOpenDialog.mockReset()
  getFocusedWindow.mockReset().mockReturnValue(undefined)
  getAllWindows.mockReset().mockReturnValue([])
})

/** Narrow the capability union to the native member this backend registers. */
function nativeCapability(picker: ElectronDirectoryPicker): DirectoryPickerNativeCapability {
  const capability = picker.capability()
  if (capability.kind !== 'native') throw new Error(`expected native capability, got ${capability.kind}`)
  return capability
}

describe('ElectronDirectoryPicker', () => {
  it('returns the picked path from the focused window dialog', async () => {
    const window = { id: 1 }
    getFocusedWindow.mockReturnValue(window)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/work'] })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(new AbortController().signal)).resolves.toBe('D:/work')
    expect(showOpenDialog).toHaveBeenCalledWith(window, { properties: ['openDirectory'] })
  })

  it('falls back to the first existing window when none is focused', async () => {
    const window = { id: 2 }
    getAllWindows.mockReturnValue([window])
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/work'] })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(new AbortController().signal)).resolves.toBe('D:/work')
    expect(showOpenDialog).toHaveBeenCalledWith(window, { properties: ['openDirectory'] })
  })

  it('opens the dialog windowless when no BrowserWindow exists', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/work'] })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(new AbortController().signal)).resolves.toBe('D:/work')
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
  })

  it('returns null when canceled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(new AbortController().signal)).resolves.toBeNull()
  })

  it('returns null when the dialog closes without paths', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(new AbortController().signal)).resolves.toBeNull()
  })

  it('returns null when the signal aborted while the dialog was open', async () => {
    const controller = new AbortController()
    showOpenDialog.mockImplementation(async () => {
      controller.abort()
      return { canceled: false, filePaths: ['D:/work'] }
    })
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(controller.signal)).resolves.toBeNull()
  })

  it('returns null without opening the dialog for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const picker = new ElectronDirectoryPicker(new Context())
    await expect(nativeCapability(picker).pick(controller.signal)).resolves.toBeNull()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})

/**
 * The renderer bridges: exactly the `window.__DSH_IPC__` shape
 * dsh-client-connection's `readIpcBridge` reads, and exactly the
 * `window.__DSH_WINDOW__` shape dsh-client-ui-layout's window-band reads.
 * Sandboxed and contextIsolated — the page never touches `ipcRenderer`, only
 * these two four-member surfaces.
 * @module @deepseek-ai/dsh-electron/preload
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__DSH_IPC__', {
  fetch: (path: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('dsh:fetch', { path, ...init }),
  openStream: (channel: 'mux' | 'host') => ipcRenderer.invoke('dsh:openStream', channel),
  closeStream: (channel: 'mux' | 'host') => ipcRenderer.invoke('dsh:closeStream', channel),
  onServerRequest: (listener: (channel: 'mux' | 'host', frame: unknown) => void) => {
    const wrapped = (_event: unknown, payload: { channel: 'mux' | 'host'; frame: unknown }): void => {
      listener(payload.channel, payload.frame)
    }
    ipcRenderer.on('dsh:server-request', wrapped)
    return () => { ipcRenderer.off('dsh:server-request', wrapped) }
  },
})

// Window-control state may arrive (main pushes at did-finish-load, earlier than
// the page mounts) before any renderer listener exists, so the preload buffers
// the latest snapshot and replays it to each new subscriber.
let windowState: { maximized: boolean } | undefined
const stateListeners = new Set<(state: { maximized: boolean }) => void>()
ipcRenderer.on('dsh:window:state', (_event, state: { maximized: boolean }) => {
  windowState = state
  for (const listener of stateListeners) listener(state)
})

contextBridge.exposeInMainWorld('__DSH_WINDOW__', {
  // The ops are literal strings the main handler validates; it rejects only on
  // a shape our own preload never produces, so the invokes are fire-and-forget.
  minimize: () => { void ipcRenderer.invoke('dsh:window:operate', 'minimize') },
  toggleMaximize: () => { void ipcRenderer.invoke('dsh:window:operate', 'toggle-maximize') },
  close: () => { void ipcRenderer.invoke('dsh:window:operate', 'close') },
  onStateChange: (listener: (state: { maximized: boolean }) => void) => {
    if (windowState !== undefined) listener(windowState)
    stateListeners.add(listener)
    return () => { stateListeners.delete(listener) }
  },
})

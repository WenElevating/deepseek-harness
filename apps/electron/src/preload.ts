/**
 * The renderer bridge: exactly the `window.__DSH_IPC__` shape
 * dsh-client-connection's `readIpcBridge` reads. Sandboxed and contextIsolated
 * — the page never touches `ipcRenderer`, only these four members.
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

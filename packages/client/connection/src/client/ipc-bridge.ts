/** The preload-injected Electron IPC bridge (wire boundary: shape is validated, not trusted). */

/** One bridged HTTP-style request. */
export interface BridgeFetchRequest {
  /** Request method, e.g. `POST`. */
  method: string
  /** Request headers. */
  headers: Record<string, string>
  /** Serialized request body; absent for bodyless requests. */
  body?: string
}

/** One bridged HTTP-style response. */
export interface BridgeFetchResponse {
  /** Response status code. */
  status: number
  /** Response headers. */
  headers: Record<string, string>
  /** Serialized response body. */
  body: string
}

/** Minimal surface the preload exposes as window.__DSH_IPC__. */
export interface IpcBridge {
  /**
   * Carry one HTTP-style request over ipcRenderer.invoke.
   * @param path - absolute request path including the query string.
   * @param init - request method, headers, and optional serialized body.
   * @returns the bridged response.
   */
  fetch(path: string, init: BridgeFetchRequest): Promise<BridgeFetchResponse>
  /**
   * Ask the main process to start pushing a stream channel's frames.
   * @param channel - stream channel to open.
   */
  openStream(channel: 'mux' | 'host'): Promise<void>
  /**
   * Ask the main process to stop pushing a stream channel's frames.
   * @param channel - stream channel to close.
   */
  closeStream(channel: 'mux' | 'host'): Promise<void>
  /**
   * Subscribe to main-process stream pushes.
   * @param listener - invoked per pushed frame with its channel.
   * @returns unsubscribe function.
   */
  onServerRequest(listener: (channel: 'mux' | 'host', frame: unknown) => void): () => void
}

declare global {
  interface Window {
    /** Desktop-shell IPC bridge injected by the preload script; absent in plain browsers. */
    __DSH_IPC__?: IpcBridge
  }
}

const BRIDGE_KEY = '__DSH_IPC__'

/**
 * Read the desktop-shell bridge; undefined outside it, loud on a malformed one.
 * @returns the validated bridge, or undefined when no preload injected one.
 * @throws when `window.__DSH_IPC__` is present but does not carry the four bridge members.
 */
export function readIpcBridge(): IpcBridge | undefined {
  const candidate = (globalThis as { [BRIDGE_KEY]?: unknown })[BRIDGE_KEY]
  if (candidate === undefined) return undefined
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('client-connection: window.__DSH_IPC__ is present but not an object')
  }
  for (const member of ['fetch', 'openStream', 'closeStream', 'onServerRequest'] as const) {
    if (typeof (candidate as Record<string, unknown>)[member] !== 'function') {
      throw new Error(`client-connection: window.__DSH_IPC__ is malformed (member ${JSON.stringify(member)})`)
    }
  }
  return candidate as IpcBridge
}

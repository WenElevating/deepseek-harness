/**
 * Electron IPC carrier for the Connection host service: binds the carrier-neutral
 * `/api` handler and the two downlink pumps to ipcMain/webContents. Composed only
 * by the electron profile; loads nowhere a plain node dsh runs.
 * @module @deepseek-ai/dsh-host-connection-electron
 */
import { ipcMain } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Activates the apiProxy Context merge read inside the inject callback below.
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  createApiFallbackHandler,
} from '@deepseek-ai/dsh-client-connection'
import { IpcStreamPumps } from './ipc-streams.ts'

/** Stable Cordis plugin name. */
export const name = 'connection-electron'
/** Service required before the carrier can claim the Host half's seat. */
export const inject = ['connection']

/** Plugin config: the IPC carrier's request-body cap. */
export interface ConnectionElectronConfig {
  /** Maximum buffered body length for every `dsh:fetch` invoke. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionElectronConfig> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** One `dsh:fetch` invoke payload (wire boundary: shape is validated, not trusted). */
interface IpcFetchRequest {
  path: string
  method: string
  headers: Record<string, string>
  body?: string
}

/**
 * Validate the renderer's fetch payload at the process boundary.
 * @param value - raw invoke argument.
 * @returns the request members for the Fetch rebuild.
 * @throws when any member is missing or has the wrong type.
 */
function parseIpcFetch(value: unknown): IpcFetchRequest {
  if (typeof value !== 'object' || value === null) throw new Error('connection-electron: malformed dsh:fetch payload')
  const raw = value as Record<string, unknown>
  if (typeof raw.path !== 'string' || !raw.path.startsWith('/')) {
    throw new Error('connection-electron: dsh:fetch path must be an absolute path string')
  }
  if (typeof raw.method !== 'string') throw new Error('connection-electron: dsh:fetch method must be a string')
  if (raw.headers !== undefined && (typeof raw.headers !== 'object' || raw.headers === null
    || Object.values(raw.headers).some(v => typeof v !== 'string'))) {
    throw new Error('connection-electron: dsh:fetch headers must be a string record')
  }
  if (raw.body !== undefined && typeof raw.body !== 'string') {
    throw new Error('connection-electron: dsh:fetch body must be a string')
  }
  const headers = (raw.headers ?? {}) as Record<string, string>
  const body = raw.body === undefined ? {} : { body: raw.body }
  return { path: raw.path, method: raw.method, headers, ...body }
}

/**
 * Validate a stream invoke's channel argument.
 * @param value - raw invoke argument.
 * @returns the logical downlink channel.
 * @throws when the value is neither `mux` nor `host`.
 */
function parseChannel(value: unknown): 'mux' | 'host' {
  if (value !== 'mux' && value !== 'host') throw new Error('connection-electron: stream channel must be "mux" or "host"')
  return value
}

/**
 * Claim the connection service's carrier seat and bind it to ipcMain. The
 * claim is per-profile and the seat holds one carrier for the tree's life:
 * re-applying this plugin (the same `electron-ipc` carrier) is tolerated,
 * a different carrier (e.g. `http-webserver`) throws, and disposal releases
 * nothing — a composition never switches carriers mid-life. IPC is a trusted
 * carrier (unreachable from the network, serving only the app's own
 * renderer), so the `/api` fallback admits privileged methods.
 * @param ctx - host plugin context carrying ctx.connection.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config?: ConnectionElectronConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  ctx.connection.claimCarrier('electron-ipc')
  const handler = ctx.connection.createSharedFetchHandler(
    '/api',
    createApiFallbackHandler(ctx, { privilegedTrusted: true }),
  )
  ctx.effect(() => {
    ipcMain.handle('dsh:fetch', async (_event, raw: unknown) => {
      const request = parseIpcFetch(raw)
      if (request.body !== undefined && request.body.length > maxRequestBodyBytes) {
        throw new Error(`connection-electron: request body exceeds maxRequestBodyBytes (${String(maxRequestBodyBytes)})`)
      }
      const response = await handler.fetch(new Request(new URL(request.path, 'http://dsh.internal'), {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      }))
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => { headers[key] = value })
      return { status: response.status, headers, body: await response.text() }
    })
    // ipcMain.handle returns void; removal goes through removeHandler.
    return () => { ipcMain.removeHandler('dsh:fetch') }
  }, 'connection-electron: dsh:fetch')
  ctx.inject(['apiProxy'], (apiCtx) => {
    const streams = new IpcStreamPumps(apiCtx.apiProxy)
    apiCtx.effect(() => {
      ipcMain.handle('dsh:openStream', (event, raw) => { streams.open(parseChannel(raw), event.sender) })
      ipcMain.handle('dsh:closeStream', (event, raw) => { streams.close(parseChannel(raw), event.sender) })
      return () => {
        ipcMain.removeHandler('dsh:openStream')
        ipcMain.removeHandler('dsh:closeStream')
        streams.closeAll()
      }
    }, 'connection-electron: stream channels')
  })
}

/** Renderer IPC carrier: unary/respond over ipcRenderer.invoke, streams over main-process push. */
import type { ApiProxy, ClientRequest, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient, RpcId } from './api.ts'
import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { randomUuid } from './random-uuid.ts'
import type { ClientConnectionRpc } from '../rpc.ts'
import type { IpcBridge } from './ipc-bridge.ts'

type IpcChannel = 'mux' | 'host'
type StreamItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }

/** Desktop-shell carrier: doFetch bridges the fetch shape over invoke; streams consume main-process push. */
export class IpcApiClient extends AbstractApiClient {
  /**
   * @param bridge - preload-injected IPC bridge.
   * @param timeoutMs - bounded unary-call timeout.
   */
  constructor(private readonly bridge: IpcBridge, timeoutMs?: number) {
    super(timeoutMs)
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    // RequestInit allows null; one normalized local treats null as absent.
    const signal: AbortSignal | undefined = init?.signal ?? undefined
    if (signal?.aborted) return Promise.reject(abortError(signal))
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const request = {
      method: init?.method ?? 'GET',
      headers,
      // postJson (the only caller) always sends a JSON string body.
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    }
    // The invoke wire has no cancellation leg: init.signal — the merged unary
    // deadline from the shared postJson — races the await here, so a hung
    // main-side invoke rejects the caller while the invoke itself runs on
    // (a late answer is dropped, as the web carrier drops an abandoned
    // connection's).
    const invoke = this.bridge.fetch(`${input.pathname}${input.search}`, request)
      .then(payload => new Response(payload.body, { status: payload.status, headers: payload.headers }))
    return signal === undefined ? invoke : raceAbort(invoke, signal)
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readIpcStream('mux', muxFrameSchema, signal, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readIpcStream('host', hostFrameSchema, signal, onOpen)
  }

  /**
   * Push-channel pump: the bridge listener is registered before openStream
   * resolves, so onOpen is advisory and early frames may already sit in the
   * inbox when it fires.
   */
  private async *readIpcStream<F extends MuxFrame | HostFrame>(
    channel: IpcChannel,
    frameSchema: { parse(value: unknown): F },
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const inbox: StreamItem<F>[] = []
    let wake: (() => void) | undefined
    let ended = false
    const push = (item: StreamItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const unsubscribe = this.bridge.onServerRequest((incoming, frame) => {
      if (incoming !== channel) return
      let full: ServerRequest
      let parsed: F
      try {
        full = serverRequestSchema.parse(frame)
        parsed = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed IPC frame on ${channel}:`, error)
        return
      }
      this.onEnvelope(full)
      push({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: parsed } })
    })
    const close = (): void => {
      if (ended) return
      ended = true
      unsubscribe()
      void this.bridge.closeStream(channel).catch(() => undefined)
      push({ kind: 'end' })
    }
    signal.addEventListener('abort', close, { once: true })
    try {
      if (signal.aborted) {
        // Return early after close: opening would order close→open on the
        // wire and strand a main-side channel with no consumer.
        close()
        return
      }
      await this.bridge.openStream(channel)
      onOpen?.()
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as StreamItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', close)
      close()
    }
  }
}

/**
 * The generic RPC caller over the same bridge (mirror of createWebConnectionRpc).
 * @param bridge - preload-injected IPC bridge.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createIpcConnectionRpc(bridge: IpcBridge): ClientConnectionRpc {
  return {
    // The invoke wire carries no cancellation leg: the caller's signal races
    // the await and a late main-side answer is dropped, like the web carrier.
    async call(channel, endpoint, payload, signal) {
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = { type: 'client-request', rpcId, method: endpoint, payload }
      if (signal?.aborted) throw abortError(signal)
      const invoke = bridge.fetch(`${channel}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      })
      const response = await (signal === undefined ? invoke : raceAbort(invoke, signal))
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`transport failure for ${channel}/${endpoint}: IPC ${String(response.status)}`)
      }
      const full = serverResponseSchema.parse(JSON.parse(response.body))
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}

/**
 * Reject with the signal's reason the moment the signal fires; the in-flight
 * promise keeps running (its late settlement is dropped).
 * @param promise - the in-flight invoke result.
 * @param signal - caller/deadline signal to race against.
 * @returns a promise settling with whichever comes first: the invoke or the abort.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

/**
 * Mirror fetch's abort rejection: the signal's reason when present, else an
 * AbortError-shaped Error (the host face's abortError's renderer-side twin).
 */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}

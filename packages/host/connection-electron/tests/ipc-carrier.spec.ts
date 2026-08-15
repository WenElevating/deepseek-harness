/** The IPC carrier: fetch invoke roundtrip, privilege policy, carrier claim, stream pump lifecycle. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

type Handler = (event: { sender: FakeSender }, raw: unknown) => unknown
type CarrierFiber = ReturnType<Context['plugin']>

class FakeSender {
  sent: Array<{ channel: string; payload: unknown }> = []
  listeners: Array<() => void> = []
  failSends = false
  send = vi.fn((channel: string, payload: unknown): void => {
    if (this.failSends) throw new Error('webContents destroyed')
    this.sent.push({ channel, payload })
  })
  once(_event: 'destroyed', listener: () => void): void {
    this.listeners.push(listener)
  }
  removeListener(_event: 'destroyed', listener: () => void): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) this.listeners.splice(index, 1)
  }
  destroy(): void {
    for (const fire of this.listeners.splice(0)) fire()
  }
}

const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  },
}))

import { apply, inject, type ConnectionElectronConfig } from '../src/index.ts'
import { IpcStreamPumps } from '../src/ipc-streams.ts'

beforeEach(() => { handlers.clear() })

/**
 * Mount the carrier as a plugin fiber over an already-provided
 * HostConnectionService (awaiting it also settles the vitest invariant
 * host's auto-mounted companion, keeping the disposal below race-free).
 */
async function mount(ctx: Context, config?: ConnectionElectronConfig): Promise<CarrierFiber> {
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return fiber
}

function fetchHandler(): Handler {
  const handler = handlers.get('dsh:fetch')
  if (handler === undefined) throw new Error('dsh:fetch handler not mounted')
  return handler
}

interface FetchResponse { status: number; headers: Record<string, string>; body: string }

describe('connection-electron dsh:fetch', () => {
  it('answers a privileged method (IPC is a trusted carrier)', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    const fiber = await mount(ctx)
    // No apiProxy is mounted, so the fallback's terminal branch answers 404;
    // the assertion point is that the privileged gate let the call through —
    // the HTTP carrier would answer 403 for the same non-loopback Host.
    const response = await fetchHandler()({ sender: new FakeSender() }, {
      path: '/api/host.pickDirectory', method: 'POST', headers: {}, body: '{}',
    })
    expect((response as FetchResponse).status).toBe(404)
    await fiber.dispose()
  })

  it('rejects a malformed payload and an oversized body', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    const fiber = await mount(ctx, { maxRequestBodyBytes: 8 })
    const sender = { sender: new FakeSender() }
    await expect(fetchHandler()(sender, { path: 1 })).rejects.toThrow('path must be an absolute path string')
    await expect(fetchHandler()(sender, null)).rejects.toThrow('malformed dsh:fetch payload')
    await expect(fetchHandler()(sender, 42)).rejects.toThrow('malformed dsh:fetch payload')
    await expect(fetchHandler()(sender, { path: 'api/x', method: 'GET' })).rejects.toThrow('absolute path')
    await expect(fetchHandler()(sender, { path: '/api/x', method: 7 })).rejects.toThrow('method must be a string')
    await expect(fetchHandler()(sender, { path: '/api/x', method: 'POST', headers: null }))
      .rejects.toThrow('headers must be a string record')
    await expect(fetchHandler()(sender, { path: '/api/x', method: 'POST', headers: 3 }))
      .rejects.toThrow('headers must be a string record')
    await expect(fetchHandler()(sender, {
      path: '/api/x', method: 'POST', headers: { 'content-type': 'application/json', n: 1 },
    })).rejects.toThrow('headers must be a string record')
    await expect(fetchHandler()(sender, { path: '/api/x', method: 'POST', body: 9 }))
      .rejects.toThrow('body must be a string')
    await expect(fetchHandler()(sender, {
      path: '/api/x', method: 'POST', headers: {}, body: '123456789',
    })).rejects.toThrow('maxRequestBodyBytes')
    await fiber.dispose()
  })

  it('round-trips a bodyful POST through the shared /api handler and serializes the response', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    const fiber = await mount(ctx, {})
    const calls: unknown[] = []
    const remove = ctx.connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'session.echo',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { echoed: true } }
      },
      { authority: 'trusted-host' },
    )
    const response = await fetchHandler()({ sender: new FakeSender() }, {
      path: '/api/session.echo', method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'session.echo', payload: { hello: 1 } }),
    }) as FetchResponse
    expect(calls).toEqual([{ endpoint: 'session.echo', payload: { hello: 1 } }])
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(JSON.parse(response.body)).toEqual({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { echoed: true } },
    })
    await remove()
    await fiber.dispose()
  })

  it('answers a bodyless GET carrying no headers member', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    const fiber = await mount(ctx, {})
    // The renderer's doFetch omits absent init members entirely; the request
    // rebuild must accept that shape (defaults: empty headers, no body).
    const response = await fetchHandler()({ sender: new FakeSender() }, {
      path: '/api/llm.models', method: 'GET',
    }) as FetchResponse
    expect(response.status).toBe(404)
    expect(response.body).toBe('not found')
    await fiber.dispose()
  })

  it('tolerates the same-carrier re-claim and refuses a different carrier', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    ctx.connection.claimCarrier('electron-ipc')
    const fiber = await mount(ctx, {})
    await fiber.dispose()
    const other = new Context()
    new HostConnectionService(other, [])
    other.connection.claimCarrier('http-webserver')
    const rejected = other.plugin({ inject: [...inject], apply }, {})
    await expect(rejected).rejects.toThrow('already claimed')
  })

  it('removes the ipcMain handler when the plugin fiber disposes', async () => {
    const ctx = new Context()
    new HostConnectionService(ctx, [])
    const fiber = await mount(ctx)
    expect(handlers.has('dsh:fetch')).toBe(true)
    await fiber.dispose()
    expect(handlers.has('dsh:fetch')).toBe(false)
  })
})

describe('connection-electron streams', () => {
  type MuxSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<MuxFrame>>
  type HostSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<HostFrame>>

  function untilAbort(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }

  async function * idle<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
    await untilAbort(signal)
  }

  function api(mux: MuxSource, host: HostSource): ApiProxy {
    return {
      events: {
        mux: (_request, signal) => mux(signal),
        host: (_request, signal) => host(signal),
      },
    } as ApiProxy
  }

  /** Provide the fake apiProxy, mount the carrier, wait for the stream handlers. */
  async function mountedStreams(mux: MuxSource, host: HostSource): Promise<CarrierFiber> {
    const ctx = new Context()
    ctx.provide('apiProxy', api(mux, host))
    new HostConnectionService(ctx, [])
    return mount(ctx)
    // The stream handlers land in the apiProxy inject fiber; wait for them
    // per-test via vi.waitFor on handlers, or via openHandler below.
  }

  function openHandler(): Handler {
    const handler = handlers.get('dsh:openStream')
    if (handler === undefined) throw new Error('dsh:openStream handler not mounted')
    return handler
  }

  function closeHandler(): Handler {
    const handler = handlers.get('dsh:closeStream')
    if (handler === undefined) throw new Error('dsh:closeStream handler not mounted')
    return handler
  }

  /** One mux source frame shaped like the WebSocket downlink spec's. */
  function muxFrame(rpcId: string, lastSeq: number): RpcRequest<MuxFrame> {
    return {
      rpcId: RpcId(rpcId),
      payload: { type: 'session/subscribed', sessionId: 'session-1' as never, lastSeq },
    }
  }

  it('pumps mux frames to the sender until destroyed', async () => {
    let muxAborted = false
    const fiber = await mountedStreams(async function * (signal) {
      try {
        yield muxFrame('mux-1', 4)
        await untilAbort(signal)
      } finally {
        muxAborted = true
      }
    }, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    await vi.waitFor(() => {
      expect(sender.sent).toEqual([{
        channel: 'dsh:server-request',
        payload: {
          channel: 'mux',
          frame: {
            type: 'server-request',
            rpcId: 'mux-1',
            method: 'session/subscribed',
            payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 4 },
          },
        },
      }])
    })
    sender.destroy()
    await vi.waitFor(() => { expect(muxAborted).toBe(true) })
    await fiber.dispose()
  })

  it('pumps host frames on the host channel', async () => {
    const fiber = await mountedStreams(idle, async function * (signal) {
      yield { rpcId: RpcId('host-1'), payload: { type: 'host/remote-event', event: 'commands/change', args: [] } }
      await untilAbort(signal)
    })
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'host')
    await vi.waitFor(() => {
      expect(sender.sent).toEqual([{
        channel: 'dsh:server-request',
        payload: {
          channel: 'host',
          frame: {
            type: 'server-request',
            rpcId: 'host-1',
            method: 'host/remote-event',
            payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
          },
        },
      }])
    })
    await fiber.dispose()
  })

  it('stops the pump on dsh:closeStream and tolerates closing an unopened channel', async () => {
    let aborted = false
    const fiber = await mountedStreams(async function * (signal) {
      try {
        await untilAbort(signal)
      } finally {
        aborted = true
      }
    }, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    closeHandler()({ sender }, 'mux')
    await vi.waitFor(() => { expect(aborted).toBe(true) })
    expect(() => closeHandler()({ sender }, 'host')).not.toThrow()
    await fiber.dispose()
  })

  it('delivers a stream/error failure frame when the source fails', async () => {
    const fiber = await mountedStreams(async function * () {
      throw new Error('mux source failed')
    }, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    await vi.waitFor(() => { expect(sender.sent).toHaveLength(1) })
    const payload = sender.sent[0]!.payload as { channel: string; frame: ServerRequest }
    expect(payload.channel).toBe('mux')
    expect(payload.frame.type).toBe('server-request')
    expect(payload.frame.method).toBe('stream/error')
    expect(payload.frame.payload).toEqual({
      type: 'stream/error',
      error: { code: 'internal', message: 'Error: mux source failed', details: {} },
    })
    await fiber.dispose()
  })

  it('contains a failure-frame delivery failure when the sender is already gone', async () => {
    const fiber = await mountedStreams(async function * () {
      yield muxFrame('mux-1', 0)
    }, idle)
    const sender = new FakeSender()
    sender.failSends = true
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    // The frame send fails; the failure frame's send fails the same way; the
    // pump swallows the second failure and completes.
    await vi.waitFor(() => { expect(sender.send).toHaveBeenCalledTimes(2) })
    await fiber.dispose()
  })

  it('skips the failure frame when the failure lands after the sender was destroyed', async () => {
    let sourceDone = false
    const fiber = await mountedStreams(async function * (signal) {
      try {
        await untilAbort(signal)
        throw new Error('source failed during teardown')
      } finally {
        sourceDone = true
      }
    }, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    sender.destroy()
    await vi.waitFor(() => { expect(sourceDone).toBe(true) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(sender.sent).toEqual([])
    await fiber.dispose()
  })

  it('restarts the channel pump on re-open', async () => {
    let opens = 0
    const aborted: boolean[] = []
    const fiber = await mountedStreams(async function * (signal) {
      const index = opens
      opens += 1
      try {
        await untilAbort(signal)
      } finally {
        aborted[index] = true
      }
    }, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    await vi.waitFor(() => { expect(opens).toBe(1) })
    openHandler()({ sender }, 'mux')
    await vi.waitFor(() => {
      expect(opens).toBe(2)
      expect(aborted[0]).toBe(true)
    })
    await fiber.dispose()
  })

  it('keys pumps per sender, so one renderer closing does not stop another', async () => {
    const started: boolean[] = []
    const aborted: boolean[] = []
    const fiber = await mountedStreams(async function * (signal) {
      const index = started.length
      started[index] = true
      try {
        await untilAbort(signal)
      } finally {
        aborted[index] = true
      }
    }, idle)
    const first = new FakeSender()
    const second = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender: first }, 'mux')
    openHandler()({ sender: second }, 'mux')
    await vi.waitFor(() => { expect(started).toHaveLength(2) })
    closeHandler()({ sender: first }, 'mux')
    await vi.waitFor(() => { expect(aborted[0]).toBe(true) })
    expect(aborted[1]).toBeUndefined()
    await fiber.dispose()
    await vi.waitFor(() => { expect(aborted[1]).toBe(true) })
  })

  it('rejects an invalid stream channel', async () => {
    const fiber = await mountedStreams(idle, idle)
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    expect(() => openHandler()({ sender }, 'other')).toThrow('"mux" or "host"')
    expect(() => closeHandler()({ sender }, 'other')).toThrow('"mux" or "host"')
    await fiber.dispose()
  })

  it('removes the stream handlers and aborts every pump on disposal', async () => {
    let muxAborted = false
    let hostAborted = false
    const fiber = await mountedStreams(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          muxAborted = true
        }
      },
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          hostAborted = true
        }
      },
    )
    const sender = new FakeSender()
    await vi.waitFor(() => { expect(handlers.has('dsh:openStream')).toBe(true) })
    openHandler()({ sender }, 'mux')
    openHandler()({ sender }, 'host')
    await vi.waitFor(() => { expect(sender.listeners).toHaveLength(2) })
    await fiber.dispose()
    expect(handlers.has('dsh:openStream')).toBe(false)
    expect(handlers.has('dsh:closeStream')).toBe(false)
    expect(handlers.has('dsh:fetch')).toBe(false)
    await vi.waitFor(() => {
      expect(muxAborted).toBe(true)
      expect(hostAborted).toBe(true)
    })
  })

  /** Narrowed view of the private seat map: the leaks this block pins live there. */
  function seats(pumps: IpcStreamPumps): Map<string, unknown> {
    return (pumps as unknown as { pumps: Map<string, unknown> }).pumps
  }

  it('detaches the superseded seat loss listener on re-open (a reload reuses the webContents)', () => {
    const pumps = new IpcStreamPumps(api(idle, idle))
    const sender = new FakeSender()
    // Six reloads re-open both channels on the same webContents; keeping one
    // loss listener per open would trip webContents' 10-listener warning.
    for (let reload = 0; reload < 6; reload += 1) {
      pumps.open('mux', sender)
      pumps.open('host', sender)
    }
    expect(sender.listeners).toHaveLength(2)
    expect(seats(pumps).size).toBe(2)
    pumps.closeAll()
    expect(sender.listeners).toHaveLength(0)
    expect(seats(pumps).size).toBe(0)
  })

  it('empties the seat when the sender is destroyed', () => {
    const pumps = new IpcStreamPumps(api(idle, idle))
    const sender = new FakeSender()
    pumps.open('mux', sender)
    pumps.open('host', sender)
    sender.destroy()
    expect(seats(pumps).size).toBe(0)
    expect(sender.listeners).toHaveLength(0)
  })

  it('releases the seat when its source ends naturally', async () => {
    const pumps = new IpcStreamPumps(api(async function * (): AsyncGenerator<RpcRequest<MuxFrame>> {}, idle))
    const sender = new FakeSender()
    pumps.open('mux', sender)
    await vi.waitFor(() => { expect(seats(pumps).size).toBe(0) })
    expect(sender.listeners).toHaveLength(0)
  })
})

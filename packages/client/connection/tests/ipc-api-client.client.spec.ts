/**
 * The IPC carrier: bridge discovery and wire-shape validation, the fetch
 * envelope roundtrip, stream pump from main-process push, concurrent invoke
 * correlation, and the renderer carrier-selection seam in apply.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  readIpcBridge,
  type BridgeFetchRequest,
  type BridgeFetchResponse,
  type IpcBridge,
} from '../src/client/ipc-bridge.ts'
import { IpcApiClient, createIpcConnectionRpc } from '../src/client/ipc-api-client.ts'
import { apply, type ConnectionHandle } from '../src/client/index.ts'
import { FixtureApiClient } from '../src/client/fixture.ts'

type BridgeGlobal = Record<string, unknown>
type Win = { location?: { hostname: string; search: string } }
type BridgeListener = (channel: 'mux' | 'host', frame: unknown) => void

afterEach(() => {
  delete (globalThis as BridgeGlobal)['__DSH_IPC__']
  delete (globalThis as Win).location
})

/**
 * Fake desktop bridge: every member is a vi.fn mock, and onServerRequest keeps
 * its registered listeners live so tests pump main-process push through `push`
 * and observe unsubscription through `listenerCount`. `mocks` carries the
 * default member mocks (unaffected by overrides) so assertions never extract
 * IpcBridge methods.
 * @param overrides - per-test member replacements.
 * @returns the bridge plus the mock-access members.
 */
function fakeBridge(overrides: Partial<IpcBridge> = {}): IpcBridge & {
  readonly mocks: { fetch: Mock; openStream: Mock; closeStream: Mock }
  push(channel: 'mux' | 'host', frame: unknown): void
  listenerCount(): number
} {
  const listeners = new Set<BridgeListener>()
  const fetch = vi.fn(async (): Promise<BridgeFetchResponse> =>
    ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }))
  const openStream = vi.fn(async (): Promise<void> => {})
  const closeStream = vi.fn(async (): Promise<void> => {})
  return {
    fetch,
    openStream,
    closeStream,
    onServerRequest: vi.fn((listener: BridgeListener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    mocks: { fetch, openStream, closeStream },
    push: (channel: 'mux' | 'host', frame: unknown) => {
      for (const listener of [...listeners]) listener(channel, frame)
    },
    listenerCount: () => listeners.size,
    ...overrides,
  }
}

/** Full-form ServerRequest wire value for one pushed stream frame. */
function serverRequest(rpcId: string, method: string, payload: unknown): unknown {
  return { type: 'server-request', rpcId, method, payload }
}

/** Full-form ServerResponse wire body echoing `rpcId` with a success value. */
function serverResponse(rpcId: string, value: unknown): string {
  return JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
}

async function mount(): Promise<ConnectionHandle> {
  const ctx = new Context()
  await ctx.plugin({ apply, inject: [] })
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) throw new Error('ctx.connection not provided')
  return handle
}

describe('readIpcBridge', () => {
  it('returns undefined outside the desktop shell', () => {
    expect(readIpcBridge()).toBeUndefined()
  })

  it('fails loud on a malformed bridge', () => {
    const globalBridge = globalThis as BridgeGlobal
    globalBridge['__DSH_IPC__'] = { fetch: 1 }
    expect(() => readIpcBridge()).toThrow('__DSH_IPC__')
    globalBridge['__DSH_IPC__'] = 42
    expect(() => readIpcBridge()).toThrow('__DSH_IPC__')
    globalBridge['__DSH_IPC__'] = null
    expect(() => readIpcBridge()).toThrow('__DSH_IPC__')
    delete globalBridge['__DSH_IPC__']
  })

  it('accepts a well-formed bridge', () => {
    const bridge = fakeBridge()
    ;(globalThis as BridgeGlobal)['__DSH_IPC__'] = bridge
    expect(readIpcBridge()).toBe(bridge)
  })
})

describe('IpcApiClient', () => {
  it('posts the envelope over the bridge and rebuilds the Response', async () => {
    const bridge = fakeBridge()
    const client = new IpcApiClient(bridge)
    // Driving full callUnary needs a UNARY_VALUE_SCHEMAS hit; observe the
    // protected doFetch directly through a narrowed view instead.
    const carrier = client as unknown as { doFetch(u: URL, i?: RequestInit): Promise<Response> }
    const response = await carrier.doFetch(new URL('/api/session.list?limit=5', 'dsh://app'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const fetch = bridge.mocks.fetch
    expect(fetch.mock.calls[0]![0]).toBe('/api/session.list?limit=5')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.text()).resolves.toBe('{}')
    // A bare call defaults to GET with no body member.
    await carrier.doFetch(new URL('/api/session.list', 'dsh://app'))
    expect(fetch.mock.calls[1]![1]).toEqual({ method: 'GET', headers: {} })
  })

  it('pumps pushed frames in arrival order, drops malformed ones, and ignores foreign channels', async () => {
    const bridge = fakeBridge()
    const client = new IpcApiClient(bridge)
    const opened: string[] = []
    const abort = new AbortController()
    const iterator = client.events.mux({}, abort.signal, () => { opened.push('mux') })[Symbol.asyncIterator]()
    const first = iterator.next()
    await vi.waitFor(() => { expect(opened).toEqual(['mux']) })
    expect(bridge.mocks.openStream).toHaveBeenCalledWith('mux')
    expect(bridge.listenerCount()).toBe(1)

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A host frame on the mux registration and a schema-invalid payload never reach the inbox.
    bridge.push('host', serverRequest('host-1', 'host/remote-event', { type: 'host/remote-event', event: 'commands/change', args: [] }))
    bridge.push('mux', serverRequest('mux-bad', 'session/subscribed', { type: 'session/subscribed' }))
    expect(errors).toHaveBeenCalledTimes(1)

    bridge.push('mux', serverRequest('mux-1', 'session/subscribed', { type: 'session/subscribed', sessionId: 's-1', lastSeq: 1 }))
    bridge.push('mux', serverRequest('mux-2', 'session/subscribed', { type: 'session/subscribed', sessionId: 's-2', lastSeq: 2 }))
    expect(await first).toMatchObject({ value: { rpcId: 'mux-1', payload: { sessionId: 's-1', lastSeq: 1 } } })
    expect(await iterator.next()).toMatchObject({ value: { rpcId: 'mux-2', payload: { sessionId: 's-2', lastSeq: 2 } } })
    errors.mockRestore()

    const done = iterator.next()
    abort.abort()
    await expect(done).resolves.toMatchObject({ done: true })
    expect(bridge.mocks.closeStream).toHaveBeenCalledWith('mux')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('ends the host stream immediately when its signal was already aborted and swallows closeStream rejection', async () => {
    const rejectingClose = vi.fn(async (): Promise<void> => { throw new Error('ipc gone') })
    const bridge = fakeBridge({ closeStream: rejectingClose })
    const client = new IpcApiClient(bridge)
    const abort = new AbortController()
    abort.abort()
    const iterator = client.events.host({}, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(rejectingClose).toHaveBeenCalledWith('host')
    // A pre-aborted signal must never open: the wire would order close→open
    // and strand a main-side channel with no consumer.
    expect(bridge.mocks.openStream).not.toHaveBeenCalled()
  })

  it('contains an openStream rejection: the iterator rejects, the listener unsubscribes, and closeStream fires', async () => {
    const rejectingOpen = vi.fn(async (): Promise<void> => { throw new Error('main refused') })
    const bridge = fakeBridge({ openStream: rejectingOpen })
    const client = new IpcApiClient(bridge)
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('main refused')
    expect(bridge.listenerCount()).toBe(0)
    expect(bridge.mocks.closeStream).toHaveBeenCalledWith('mux')
  })

  it('rejects doFetch when the deadline signal fires while the invoke hangs', async () => {
    const bridge = fakeBridge({
      fetch: vi.fn(() => new Promise<BridgeFetchResponse>(() => {})),
    })
    const client = new IpcApiClient(bridge)
    const carrier = client as unknown as { doFetch(u: URL, i?: RequestInit): Promise<Response> }
    const controller = new AbortController()
    const pending = carrier.doFetch(new URL('/api/session.list', 'dsh://app'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    })
    const assertion = expect(pending).rejects.toThrow('aborted')
    controller.abort()
    await assertion
  })

  it('rejects doFetch on a pre-aborted signal without calling bridge.fetch', async () => {
    const bridge = fakeBridge()
    const client = new IpcApiClient(bridge)
    const carrier = client as unknown as { doFetch(u: URL, i?: RequestInit): Promise<Response> }
    const controller = new AbortController()
    controller.abort()
    await expect(carrier.doFetch(new URL('/api/session.list', 'dsh://app'), {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    })).rejects.toThrow('aborted')
    expect(bridge.mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects the generic rpc call on caller abort mid-flight', async () => {
    let invoked = false
    const bridge = fakeBridge({
      fetch: vi.fn(() => {
        invoked = true
        return new Promise<BridgeFetchResponse>(() => {})
      }),
    })
    const controller = new AbortController()
    const pending = createIpcConnectionRpc(bridge).call('/api', 'goals/create', {}, controller.signal)
    const assertion = expect(pending).rejects.toThrow('aborted')
    await vi.waitFor(() => { expect(invoked).toBe(true) })
    controller.abort()
    await assertion
  })

  it('correlates concurrent invokes by rpcId when responses replay out of order', async () => {
    const requests: Array<{ rpcId: string; tag: string }> = []
    const responders: Array<(response: BridgeFetchResponse) => void> = []
    const bridge = fakeBridge({
      fetch: vi.fn(async (_path: string, init: BridgeFetchRequest) => {
        const message = JSON.parse(init.body ?? '{}') as { rpcId: string; payload: { tag: string } }
        requests.push({ rpcId: message.rpcId, tag: message.payload.tag })
        return await new Promise<BridgeFetchResponse>((resolve) => { responders.push(resolve) })
      }),
    })
    const rpc = createIpcConnectionRpc(bridge)
    const first = rpc.call('/api', 'goals/create', { tag: 'first' })
    const second = rpc.call('/api', 'goals/create', { tag: 'second' })
    await vi.waitFor(() => { expect(responders).toHaveLength(2) })
    expect(new Set(requests.map(request => request.rpcId)).size).toBe(2)

    const reply = (tag: string): BridgeFetchResponse => {
      const request = requests.find(candidate => candidate.tag === tag)
      if (request === undefined) throw new Error(`no invoke captured for tag ${JSON.stringify(tag)}`)
      return { status: 200, headers: {}, body: serverResponse(request.rpcId, { answered: tag }) }
    }
    // Replay in reverse arrival order; each promise must still resolve its own answer.
    responders[1]!(reply('second'))
    responders[0]!(reply('first'))
    await expect(first).resolves.toEqual({ ok: true, value: { answered: 'first' } })
    await expect(second).resolves.toEqual({ ok: true, value: { answered: 'second' } })
  })

  it('fails loud on IPC transport failure and rpcId mismatch', async () => {
    const unavailable = fakeBridge({ fetch: vi.fn(async () => ({ status: 503, headers: {}, body: '' })) })
    await expect(createIpcConnectionRpc(unavailable).call('/api', 'goals/create', {}))
      .rejects.toThrow('transport failure for /api/goals/create: IPC 503')

    const crossed = fakeBridge({
      fetch: vi.fn(async () => ({ status: 200, headers: {}, body: serverResponse('different-rpc', null) })),
    })
    await expect(createIpcConnectionRpc(crossed).call('/api', 'goals/create', {})).rejects.toThrow('rpcId mismatch')
  })
})

describe('connection client apply IPC seam', () => {
  it('selects the IPC carrier and loopback trust whenever the bridge is present', async () => {
    const bridge = fakeBridge()
    ;(globalThis as BridgeGlobal)['__DSH_IPC__'] = bridge
    ;(globalThis as Win).location = { hostname: '192.0.2.20', search: '' }
    const handle = await mount()
    expect(handle.api).toBeInstanceOf(IpcApiClient)
    expect(handle.isLoopback).toBe(true)
    // The generic RPC channel rides the same bridge (the default fake body fails schema parse).
    await expect(handle.rpc.call('/api', 'goals/create', {})).rejects.toThrow()
    expect(bridge.mocks.fetch).toHaveBeenCalledWith('/api/goals/create', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps the fixture carrier ahead of the IPC bridge under ?fixture', async () => {
    ;(globalThis as BridgeGlobal)['__DSH_IPC__'] = fakeBridge()
    ;(globalThis as Win).location = { hostname: '192.0.2.20', search: '?fixture' }
    expect((await mount()).api).toBeInstanceOf(FixtureApiClient)
  })
})

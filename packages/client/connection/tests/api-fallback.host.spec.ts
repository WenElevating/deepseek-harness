/** The carrier-neutral /api fallback: privileged gate, 426, apiProxy dispatch. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createApiFallbackHandler } from '../src/api-fallback.ts'

function request(path: string, init: RequestInit = {}): Request {
  return new Request(new URL(path, 'http://dsh.internal'), { method: 'POST', headers: { host: '127.0.0.1' }, ...init })
}

describe('createApiFallbackHandler', () => {
  it('refuses a privileged method when the carrier is not trusted', async () => {
    const ctx = new Context()
    const handler = createApiFallbackHandler(ctx, { privilegedTrusted: false })
    const response = await handler.fetch(request('/api/host.pickDirectory', { method: 'POST', headers: { host: 'dsh.internal', 'content-type': 'application/json' } }))
    expect(response.status).toBe(403)
  })

  it('admits a privileged method when the carrier declares trust', async () => {
    const ctx = new Context()
    const handler = createApiFallbackHandler(ctx, { privilegedTrusted: true })
    const response = await handler.fetch(request('/api/host.pickDirectory'))
    // No apiProxy is mounted: the 404 proves the request passed the gate.
    expect(response.status).toBe(404)
  })

  it('answers 426 for GET on the two event paths', async () => {
    const ctx = new Context()
    const handler = createApiFallbackHandler(ctx, { privilegedTrusted: false })
    for (const path of ['/api/events.mux', '/api/events.host']) {
      const response = await handler.fetch(new Request(new URL(path, 'http://dsh.internal'), { method: 'GET', headers: { host: '127.0.0.1' } }))
      expect(response.status).toBe(426)
    }
  })
})

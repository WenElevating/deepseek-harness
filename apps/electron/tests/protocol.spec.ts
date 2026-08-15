/** The dsh:// protocol handler maps dist files, bundles, and the export route exactly as the HTTP carrier does. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { afterEach, describe, expect, it } from 'vitest'
import { handleDshProtocol } from '../src/protocol.ts'

/** Active session-export api for the current test; undefined leaves the route unmounted. */
let apiProxy: ApiProxy | undefined

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
  apiProxy = undefined
})

const GRAPH: WebBootGraph = {
  rev: 'rev000000001',
  entries: [{ id: '@deepseek-ai/dsh-fixture', url: '/plugins/@deepseek-ai/dsh-fixture/client.js?rev=rev000000001', rev: 'rev000000001' }],
}

/**
 * Build one dist fixture with the given files plus a booted-tree stand-in
 * whose clientModules maps the fixture bundle.
 * @param files - dist-relative file contents.
 * @param bundleJs - mapped client bundle content; omit to register no bundle.
 * @returns the dist root path and the context double.
 */
function fixture(files: Record<string, string>, bundleJs?: string): { distRoot: string; ctx: Context } {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-electron-protocol-')))
  const distRoot = join(root, 'dist')
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(distRoot, dirname(name)), { recursive: true })
    writeFileSync(join(distRoot, name), content)
  }
  const bundlePath = join(root, 'bundles', 'client.js')
  if (bundleJs !== undefined) {
    mkdirSync(join(root, 'bundles'), { recursive: true })
    writeFileSync(bundlePath, bundleJs)
    writeFileSync(`${bundlePath}.map`, '{"version":3}')
  }
  const clientModules = {
    graph: () => GRAPH,
    clientPath: (id: string) => id === '@deepseek-ai/dsh-fixture' && bundleJs !== undefined ? bundlePath : undefined,
  }
  const ctx = { clientModules, get: (name: string) => name === 'apiProxy' ? apiProxy : undefined }
  return { distRoot, ctx: ctx as unknown as Context }
}

/**
 * Issue one protocol request.
 * @param ctx - the booted-tree stand-in.
 * @param distRoot - the dist root.
 * @param url - the full dsh:// URL.
 * @returns the handled response.
 */
async function request(ctx: Context, distRoot: string, url: string): Promise<Response> {
  return handleDshProtocol(ctx, distRoot, new Request(url))
}

describe('handleDshProtocol', () => {
  it('serves index.html with the boot graph injected as the first head script', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html><head><title>dsh</title></head><body></body></html>' })
    const response = await request(ctx, distRoot, 'dsh://app/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    const scriptAt = html.indexOf('<script>window.__DSH_BOOT__ = ')
    expect(scriptAt).toBeGreaterThan(html.indexOf('<head>'))
    expect(scriptAt).toBeLessThan(html.indexOf('</title>'))
  })

  it('serves dist assets with extension MIME types and an octet-stream fallback', async () => {
    const { distRoot, ctx } = fixture({ 'assets/app.js': 'export {}', 'assets/logo.svg': '<svg/>', 'assets/data.bin': 'raw' })
    const js = await request(ctx, distRoot, 'dsh://app/assets/app.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect((await request(ctx, distRoot, 'dsh://app/assets/logo.svg')).headers.get('content-type')).toBe('image/svg+xml')
    expect((await request(ctx, distRoot, 'dsh://app/assets/data.bin')).headers.get('content-type')).toBe('application/octet-stream')
  })

  it('refuses encoded dot segments that escape the dist root', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>' })
    expect((await request(ctx, distRoot, 'dsh://app/..%2f..%2fsecret.txt')).status).toBe(403)
  })

  it('answers missing files and directories with 404 and malformed encoding with 400', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>', 'nested/.keep': '' })
    expect((await request(ctx, distRoot, 'dsh://app/missing.js')).status).toBe(404)
    expect((await request(ctx, distRoot, 'dsh://app/nested')).status).toBe(404)
    expect((await request(ctx, distRoot, 'dsh://app/%E0%A4%A')).status).toBe(400)
  })

  it('serves registered bundles and their source maps through the same mapping as the HTTP route', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>' }, 'module.exports = 1')
    const bundle = await request(ctx, distRoot, 'dsh://app/plugins/@deepseek-ai/dsh-fixture/client.js')
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await bundle.text()).toBe('module.exports = 1')
    const map = await request(ctx, distRoot, 'dsh://app/plugins/@deepseek-ai/dsh-fixture/client.js.map')
    expect(map.status).toBe(200)
    expect(map.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it('answers unknown or malformed bundle paths with 404', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>' }, 'module.exports = 1')
    expect((await request(ctx, distRoot, 'dsh://app/plugins/@deepseek-ai/unknown/client.js')).status).toBe(404)
    expect((await request(ctx, distRoot, 'dsh://app/plugins/@deepseek-ai/dsh-fixture/client.css')).status).toBe(404)
  })

  it('routes the session export through the api proxy and preserves its disposition header', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>' })
    apiProxy = {
      downloads: {
        sessionLog: async () => new Response('zip-bytes', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="session-abc.zip"' },
        }),
      },
    } as unknown as ApiProxy
    const response = await request(ctx, distRoot, 'dsh://app/api/session.export?sessionId=abc')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="session-abc.zip"')
    expect(await response.text()).toBe('zip-bytes')
  })

  it('answers the export route with 404 when no api proxy is mounted', async () => {
    const { distRoot, ctx } = fixture({ 'index.html': '<html></html>' })
    expect((await request(ctx, distRoot, 'dsh://app/api/session.export?sessionId=abc')).status).toBe(404)
  })
})

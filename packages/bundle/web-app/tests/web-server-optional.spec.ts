/**
 * webServer optionality: without a webServer the runtime still provides the
 * `webRuntime` service (the `connection` row's inject target in a server-less
 * profile) as an empty trust snapshot and mounts nothing HTTP-bound; a
 * webServer fiber that exists but has not finished binding still takes the
 * server-present path — in the shipped composition this row activates while
 * the webserver row's listen is still in flight.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, internals } from '../src/index.ts'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

let dist: string | undefined

afterEach(() => {
  vi.restoreAllMocks()
  internals.resolveDistIndex = originalResolve
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

const originalResolve = internals.resolveDistIndex

/** Stage a dist fixture and point the bundle's resolver at it. */
function stageDist(): void {
  dist = mkdtempSync(join(tmpdir(), 'dsh-web-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
}

/** A fake webServer value: config-derived host, fixed port, captured seat. */
function fakeHttpServer(host: '127.0.0.1' | '0.0.0.0'): { server: WebServer; seat: () => unknown } {
  let fallback: unknown
  const server = {
    host,
    port: 4567,
    registerFallback: (handler: unknown) => {
      fallback = handler
      return () => { fallback = undefined }
    },
    applyIndexTaps: (html: string) => html,
  } as unknown as WebServer
  return { server, seat: () => fallback }
}

/**
 * A Loader stand-in whose settlement the test controls: stands for the
 * assembled tree's settlement, which fulfills after every row activated and
 * rejects when an entry fiber failed the boot.
 * @param awaitResult - the promise `loader.await()` returns.
 * @returns the fake `loader` service value.
 */
function fakeLoader(awaitResult: Promise<void>): Loader {
  return { await: () => awaitResult } as unknown as Loader
}

/** Capture process-level unhandled rejections for the returned assert/inspect pair. */
function trackUnhandledRejections(): { rejections: unknown[]; off: () => void } {
  const rejections: unknown[] = []
  const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  return { rejections, off: () => process.off('unhandledRejection', onUnhandled) }
}

describe('web-app webServer optionality', () => {
  it('provides an empty webRuntime and mounts no plugin child without a webServer', async () => {
    const ctx = new Context()
    const pluginChildren: string[] = []
    ctx.on('internal/plugin', fiber => pluginChildren.push(fiber.name))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ printUrl: true, surfaceContext: false, trustedHosts: [] }))
    expect(ctx.get('webRuntime')).toEqual({ lanAddresses: [], trustedHosts: [] })
    // frontend-static (and any other HTTP-bound child) must not mount.
    expect(pluginChildren).toEqual([])
    // printUrl was requested: with no server there is no URL to print.
    expect(log).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('samples LAN trust from a webServer fiber that is still binding', async () => {
    stageDist()
    const ctx = new Context()
    const { server, seat } = fakeHttpServer('0.0.0.0')
    // The providing fiber's callback has stored the service while the fiber
    // is still LOADING — strict reads hide it until the listen settles, so
    // presence must be sampled non-strictly (the webserver row binds while
    // this row activates).
    let releaseServer: () => void
    const serverListening = new Promise<void>((resolve) => { releaseServer = resolve })
    let serverStored: () => void
    const stored = new Promise<void>((resolve) => { serverStored = resolve })
    ctx.plugin({
      name: 'web-server',
      apply: (serverCtx: Context) => {
        serverCtx.provide('webServer', server)
        serverStored!()
        return serverListening
      },
    })
    await stored
    const pluginChildren: string[] = []
    ctx.on('internal/plugin', fiber => pluginChildren.push(fiber.name))
    apply(ctx, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [] }))
    expect(ctx.get('webRuntime')).toEqual({ lanAddresses: ['192.168.1.5'], trustedHosts: ['192.168.1.5'] })
    releaseServer!()
    // Once the server fiber settles, the frontend-static child activates and
    // claims the fallback seat.
    await vi.waitFor(() => { expect(seat()).toBeDefined() })
    expect(pluginChildren).toContain('frontend-static')
    await ctx.fiber.dispose()
  })

  it('throws when a webServer first becomes visible after the server-absent path committed', async () => {
    const ctx = new Context()
    let resolveSettlement!: () => void
    const settled = new Promise<void>((resolve) => { resolveSettlement = resolve })
    ctx.provide('loader', fakeLoader(settled))
    const { rejections, off } = trackUnhandledRejections()
    try {
      // Stands for the misordered Loader composition: the web-app row ordered
      // before the webserver row, so the webServer service first appears
      // while this row is already committed to the server-less path. The
      // thrown error surfaces as the row's unhandled rejection, which the
      // app-boot fail-loud guard turns into a fatal exit.
      apply(ctx, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [] }))
      const { server } = fakeHttpServer('127.0.0.1')
      let serverStored!: () => void
      const stored = new Promise<void>((resolve) => { serverStored = resolve })
      ctx.plugin({
        name: 'web-server',
        apply: (serverCtx: Context) => {
          serverCtx.provide('webServer', server)
          serverStored()
        },
      })
      await stored
      resolveSettlement()
      await vi.waitFor(() => { expect(rejections).toHaveLength(1) })
      expect((rejections[0] as Error).message).toContain('webServer appeared only after')
    } finally {
      off()
    }
    await ctx.fiber.dispose()
  })

  it('stays on the server-less path when settlement fulfills without a webServer ever created', async () => {
    const ctx = new Context()
    let resolveSettlement!: () => void
    const settled = new Promise<void>((resolve) => { resolveSettlement = resolve })
    ctx.provide('loader', fakeLoader(settled))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { rejections, off } = trackUnhandledRejections()
    try {
      // Stands for the Electron main-process profile: a Loader tree that
      // never creates a webserver row.
      apply(ctx, new Config({ printUrl: true, surfaceContext: false, trustedHosts: [] }))
      resolveSettlement()
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(rejections).toEqual([])
      expect(ctx.get('webRuntime')).toEqual({ lanAddresses: [], trustedHosts: [] })
      expect(log).not.toHaveBeenCalled()
    } finally {
      off()
    }
    await ctx.fiber.dispose()
  })

  it('stays quiet when Loader settlement reports a failed boot', async () => {
    const ctx = new Context()
    ctx.provide('loader', fakeLoader(Promise.reject(new Error('entry fiber failed'))))
    const { rejections, off } = trackUnhandledRejections()
    try {
      apply(ctx, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [] }))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(rejections).toEqual([])
    } finally {
      off()
    }
    await ctx.fiber.dispose()
  })
})

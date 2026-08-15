/** The registry must compose and serve graph data with no webServer mounted. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientModuleRegistry } from '../src/index.ts'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Construct the node-half service over one resolvable client package with only
 * the loader mounted — no webServer (the server-less carrier of an Electron
 * main-process host, which reads graph()/clientPath() directly).
 * @param packageName - fixture package declaring `dsh.client` with a built bundle.
 * @returns the context and the constructed registry.
 */
function constructWithoutCarrier(packageName: string): { ctx: Context; service: ClientModuleRegistry } {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    dsh: { client: { platform: 'web' } },
  }))
  mkdirSync(join(pkgRoot, 'lib'), { recursive: true })
  writeFileSync(clientPath, 'module.exports = {}\n')
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  ctx.provide('loader', {
    *entries() {
      yield { options: { name: packageName }, fiber: {}, disabled: false }
    },
  })
  return { ctx, service: new ClientModuleRegistry(ctx) }
}

describe('ClientModuleRegistry without webServer', () => {
  it('constructs and exposes the graph without mounting HTTP routes', async () => {
    const packageName = '@fixture/carrier-less'
    const { ctx, service } = constructWithoutCarrier(packageName)
    expect(service.graph().entries).toBeDefined()
    expect(service.graph().entries.map(entry => entry.id)).toEqual([packageName])
    expect(ctx.get('webServer')).toBeUndefined()
  })
})

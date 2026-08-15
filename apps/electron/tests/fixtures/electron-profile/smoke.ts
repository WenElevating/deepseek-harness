/**
 * Headless `electron` profile smoke: boots the real desktop composition in
 * plain Node through `runProfile` — the same launcher entry `dsh --profile
 * electron` and the desktop main process use — with the `electron` builtin
 * stubbed at the resolve-hook level. The vendored Loader imports plugin rows
 * natively from the profile directory, so the npm `electron` package (whose
 * plain-Node export is just the binary path string) must never load: the stub
 * supplies the only surface the tree's two desktop rows import. Asserts the
 * boots settle with no webServer, the IPC carrier claims the connection seat,
 * and one keyless transcript crosses both the in-process client and the
 * `dsh:fetch` carrier; prints one JSON line and exits through the bounded
 * shutdown.
 */

import { registerHooks } from 'node:module'

// The stub must precede every workspace import: the vendored Loader resolves
// plugin rows at boot time (after this module body runs), but the hook itself
// has to be registered before any module that (transitively) imports
// `electron` is linked — hence dynamic imports below.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: new URL('./electron-stub.mjs', import.meta.url).href,
        format: 'module',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { runProfile } = await import('@deepseek-ai/dsh/profile-boot')
const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
const { InProcessApiClient, toFetchHandler } = await import('@deepseek-ai/dsh-host-apiproxy')
const { ipcHandlers } = await import('./electron-stub.mjs')
// Context merges for the services this smoke reads (apiProxy, connection, webServer).
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Fail loud with the failing name when a boot fact does not hold. */
function requireFact(name: string, ok: boolean): void {
  if (!ok) throw new Error(`electron profile smoke: ${name}`)
}

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'electron',
  patchFiles: [],
  args: [],
})

const webServerAbsent = ctx.get('webServer') === undefined
requireFact('the composition mounts no webServer service', webServerAbsent)
let connectionCarried = true
try {
  ctx.connection.assertCarried()
} catch {
  connectionCarried = false
}
requireFact('the connection seat is carried (electron-ipc claim)', connectionCarried)
for (const channel of ['dsh:fetch', 'dsh:openStream', 'dsh:closeStream']) {
  requireFact(`ipcMain carries the ${channel} channel`, ipcHandlers.has(channel))
}
const fetchHandler = ipcHandlers.get('dsh:fetch')!

/** Unwrap a carrier client result or fail loud with the error result. */
function expectOk<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`electron profile smoke: transcript call failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

const apiProxy = ctx.get('apiProxy')
if (apiProxy === undefined) throw new Error('electron profile smoke: apiProxy service is absent after settled boot')
const client = new InProcessApiClient(toFetchHandler(apiProxy))
const hostDescribe = expectOk((await client.host.describe({})).result)
requireFact('host.describe reports the boot cwd', hostDescribe.cwd === process.cwd())
const sessionList = expectOk((await client.sessions.list({})).result)

// One request through the carrier the renderer would use: the stubbed
// `dsh:fetch` invoke path is the whole IPC seam, from the fetch payload to the
// response body string.
const carrierAnswer = await fetchHandler(undefined, {
  path: '/api/host.describe',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'electron-profile-headless', method: 'host.describe', payload: {} }),
}) as { status: number; body: string }
const carrierEnvelope = JSON.parse(carrierAnswer.body) as { result: { ok: boolean } }

const payload = {
  webServerAbsent,
  connectionCarried,
  ipcChannels: [...ipcHandlers.keys()].sort(),
  carrierRoundTrip: { status: carrierAnswer.status, ok: carrierEnvelope.result.ok },
  hostDescribe: {
    version: hostDescribe.version,
    cwd: process.cwd(),
    attachedSessions: hostDescribe.attachedSessions,
    ...('provider' in hostDescribe ? { provider: hostDescribe.provider } : {}),
    ...('model' in hostDescribe ? { model: hostDescribe.model } : {}),
  },
  sessionList: { items: sessionList.items },
}
process.stdout.write(`${JSON.stringify(payload)}\n`)
await shutdown.shutdown(0)

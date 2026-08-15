/** Headless keyless snapshot of the `electron` profile: plain-Node boot, IPC carrier, no webServer. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/electron-profile/', import.meta.url))
const binScript = `${FIXTURE_DIR}smoke.ts`
// configPath is a required LoaderSmokeOptions field, but binArgs replaces the
// default `[configPath]` argv entirely: this smoke owns its composition through
// runProfile('electron'), not a config argument. The path below is inert.
const inertConfigPath = `${FIXTURE_DIR}electron-stub.mjs`
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
// The desktop composition is the largest profile boot in the repo (base +
// web-app + electron-app layers, plus the launcher's flat module fallback
// heal); the subprocess owns its own 90s deadline inside this 105s one.
const SMOKE_PROCESS_TIMEOUT_MS = 90_000
const SMOKE_TEST_TIMEOUT_MS = 105_000

/** The smoke's JSON payload; cwd is the one run-local member and is tokenized by the test. */
interface SmokePayload {
  webServerAbsent: boolean
  connectionCarried: boolean
  ipcChannels: string[]
  carrierRoundTrip: { status: number; ok: boolean }
  hostDescribe: { version: string; cwd: string; attachedSessions: number; provider?: string; model?: string }
  sessionList: { items: unknown[] }
}

describe('electron profile headless snapshot', () => {
  it('boots settled over the IPC carrier with no webServer and answers one keyless transcript', async () => {
    const result = await runLoaderSmoke({
      label: 'electron profile headless snapshot',
      tempDirPrefix: 'dsh-electron-profile-snapshot-',
      binScript,
      libBinScript: binScript,
      binArgs: [],
      configPath: inertConfigPath,
      tsconfigPath,
      processTimeoutMs: SMOKE_PROCESS_TIMEOUT_MS,
    })

    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as SmokePayload
    payload.hostDescribe.cwd = '{{cwd}}'
    expect(payload).toMatchInlineSnapshot(`
      {
        "carrierRoundTrip": {
          "ok": true,
          "status": 200,
        },
        "connectionCarried": true,
        "hostDescribe": {
          "attachedSessions": 0,
          "cwd": "{{cwd}}",
          "model": "deepseek-v4-flash",
          "provider": "deepseek-official",
          "version": "0.0.1",
        },
        "ipcChannels": [
          "dsh:closeStream",
          "dsh:fetch",
          "dsh:openStream",
        ],
        "sessionList": {
          "items": [],
        },
        "webServerAbsent": true,
      }
    `)
  }, SMOKE_TEST_TIMEOUT_MS)
})

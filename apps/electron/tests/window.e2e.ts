/**
 * Window-level e2e for the desktop shell: boots the real built app through
 * Playwright's Electron support and pins its security posture — a sandboxed,
 * context-isolated, node-integration-off renderer over the `dsh://app`
 * origin, with the boot graph injected and external navigation refused. The
 * committed `--dsh-smoke` flag stays a local automation gate (boot graph,
 * bridge members, carrier round-trip; the headless profile snapshot is the
 * CI signal); this suite covers what only a
 * real window proves: the BrowserWindow's resolved webPreferences and the
 * renderer's actual document. Self-skips on display-less hosts and on an
 * explicit `DSH_ELECTRON_E2E=0` opt-out.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import type { WebContents, WebPreferences } from 'electron'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// dirname strips the trailing separator: a backslash-terminated Windows path
// would escape Playwright's closing quote and hand Electron an argument
// ending in a literal `"` (it then fails to find the app).
const APP_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
/** The web frontend dist the `dsh://` protocol serves; `pnpm run test:web` builds it. */
const WEB_DIST_INDEX = fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))
/** The Electron binary: the installed `electron` package's plain-Node export is its path. */
const ELECTRON_EXECUTABLE = createRequire(import.meta.url)('electron') as string
const APP_ORIGIN = 'dsh://app'

/** A window needs a display: win32/darwin have one, elsewhere DISPLAY or WAYLAND_DISPLAY must name it. */
const windowAvailable = process.env.DSH_ELECTRON_E2E !== '0'
  && (process.platform === 'win32' || process.platform === 'darwin'
    || process.env.DISPLAY !== undefined || process.env.WAYLAND_DISPLAY !== undefined)

describe.skipIf(!windowAvailable)('desktop shell window e2e', () => {
  let electronApp: ElectronApplication
  let page: Page
  /** The isolated temp harness home; afterAll removes it once the app is gone. */
  let harnessHome: string | undefined

  beforeAll(async () => {
    if (!existsSync(WEB_DIST_INDEX)) {
      throw new Error(`web app dist missing at ${WEB_DIST_INDEX} — run \`pnpm run test:web\` (it builds lib and web dist first)`)
    }
    // The web lane builds lib and the web dist but never the desktop shell,
    // so the shell's own build (main lib + preload bundle) runs here beside
    // its only consumer; tsc -b is incremental once warm.
    await execa('pnpm', ['run', 'build'], { cwd: APP_ROOT })
    // The app writes its profile, settings, and sessions under $DSH_HOME: an
    // isolated temp home keeps the e2e off the developer's real harness home.
    harnessHome = await mkdtemp(join(tmpdir(), 'dsh-electron-window-e2e-'))
    electronApp = await _electron.launch({
      executablePath: ELECTRON_EXECUTABLE,
      args: [APP_ROOT],
      env: { ...process.env, DSH_HOME: harnessHome },
    })
    page = await electronApp.firstWindow({ timeout: 90_000 })
  }, 180_000)

  afterAll(async () => {
    // Close the window first, exactly like a user quitting the app: the
    // window's destruction fires the app's own window-all-closed quit path,
    // which disposes the tree with no live renderer refetching bundles.
    // Quitting app-first (plain close()) leaves the renderer alive through
    // the whole tree dispose and it retries its plugin-bundle fetches in a
    // loop against the disposed protocol handler, delaying process exit by
    // minutes on Windows.
    await page?.close()
    await electronApp?.close()
    // Only Windows' brief post-exit file locks (EBUSY/EPERM) on files the
    // app just wrote can fail this rm; residue under the OS temp dir beats
    // failing the suite over a lock that clears on its own.
    if (harnessHome !== undefined) {
      await rm(harnessHome, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('opens the sandboxed shell with the boot graph over the locked dsh://app origin', async () => {
    // `getLastWebPreferences` is the resolved post-defaults view; electron@39
    // typings omit it, so the evaluate names the runtime method directly.
    const preferences = await electronApp.evaluate(({ BrowserWindow }) =>
      (BrowserWindow.getAllWindows()[0]!.webContents as WebContents & { getLastWebPreferences(): WebPreferences })
        .getLastWebPreferences())
    expect(preferences.contextIsolation).toBe(true)
    expect(preferences.sandbox).toBe(true)
    expect(preferences.nodeIntegration).toBe(false)

    // firstWindow resolves once the window object exists, still on
    // about:blank; the shell's own loadURL is what lands it on dsh://app/.
    // The URL is compared whole, not via URL.origin: Node's WHATWG parser
    // gives custom schemes an opaque origin ("null"), unlike Chromium, whose
    // document.location.origin below does read "dsh://app".
    await page.waitForURL(`${APP_ORIGIN}/`)
    expect(page.url()).toBe(`${APP_ORIGIN}/`)
    // The React shell mounts into #root and renders its keyless onboarding
    // surface, so an empty root means the boot graph or a client bundle
    // failed to load; waitForFunction retries through the app's boot.
    await page.waitForFunction(() => {
      const root = document.getElementById('root')
      return root !== null && root.innerHTML.trim().length > 0
    })
    const bootPresent = await page.evaluate(() => Boolean((window as { __DSH_BOOT__?: unknown }).__DSH_BOOT__))
    expect(bootPresent).toBe(true)

    // The window never navigates away from its own surface: the refused
    // window.open leaves the document on dsh://app. The main-process stub
    // replaces only the user-facing warning modal, not the deny verdict —
    // the open handler's `action: 'deny'` is the fact under test.
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    })
    const originAfterOpen = await page.evaluate(() => new Promise<string>((resolve) => {
      window.open('https://example.com')
      setTimeout(() => { resolve(document.location.origin) }, 200)
    }))
    expect(originAfterOpen).toBe(APP_ORIGIN)
  })
})

/**
 * dsh desktop main: boot the electron profile, register the `dsh://`
 * privileged protocol over the built web dist, open the window. Window and
 * protocol only — `/api` rides the connection-electron IPC carrier inside the
 * tree.
 * @module @deepseek-ai/dsh-electron/main
 */
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { handleDshProtocol } from './protocol.ts'

const require = createRequire(import.meta.url)
/** Absolute path of the built web frontend dist (apps/web dist, one hop up the export map). */
const DIST_ROOT = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
/** The sandboxed preload bundle; esbuild emits exactly this classic CJS file. */
const PRELOAD_PATH = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
/** Window/taskbar icon: the bare whale mark on transparency; build/icon.svg is the source (see README). */
const ICON_PATH = fileURLToPath(new URL('../build/icon.png', import.meta.url))
const APP_ORIGIN = 'dsh://app'
/** The desktop profile this shell boots. */
const PROFILE = 'electron'
/** argv flag that replaces dialogs and interactive lifetime with machine-checked assertions and an exit code. */
const SMOKE_FLAG = '--dsh-smoke'
const smoke = process.argv.includes(SMOKE_FLAG)

/**
 * Electron's embedded Node hides the internal ESM loader (the
 * node-addon-require-builtin realm probe finds no compatible symbol), so the
 * vendored Loader falls back to importing plugin specifiers from its own
 * package, where no workspace dependency resolves. The hook retries each
 * failed `@deepseek-ai/` import anchored at the booted profile's directory:
 * the parent-walk from there reaches both the profile's own node_modules and
 * the launcher-maintained `$DSH_HOME/profiles/node_modules` fallback — the
 * same resolution the internal-loader path provides under plain Node.
 */
function installProfileResolutionRetry(): void {
  let anchor: string | undefined
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (!specifier.startsWith('@deepseek-ai/')) throw error
        anchor ??= `${pathToFileURL(resolveProfileDir(PROFILE)).href}/`
        return nextResolve(specifier, { ...context, parentURL: anchor })
      }
    },
  })
}

// Must precede app ready: the privileges are what let the renderer use
// relative URLs, fetch, and streaming responses against dsh://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dsh', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

/**
 * Render a failure with its full cause chain: a boot failure's actionable
 * reason (the failing entry, the import error) sits below the top aggregate,
 * and an aggregate names each failing entry.
 * @param error - the failure.
 * @returns the multi-line text for stderr and the error box.
 */
function renderFailure(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  let depth = 0
  while (current !== undefined && depth < 10) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === 'string' ? current : JSON.stringify(current))
      break
    }
    parts.push(depth === 0
      ? current.stack ?? `${current.name}: ${current.message}`
      : `${current.name}: ${current.message}`)
    const errors = (current as AggregateError).errors
    if (Array.isArray(errors)) {
      for (const inner of errors) parts.push(renderFailure(inner))
      break
    }
    current = current.cause
    depth += 1
  }
  return parts.join('\ncaused by: ')
}

/**
 * Report a fatal startup failure: always on stderr (automation and
 * `ELECTRON_ENABLE_LOGGING`), as an error box for the interactive user.
 * @param error - the failure.
 */
function failLoud(error: unknown): void {
  const text = renderFailure(error)
  console.error(text)
  if (!smoke) dialog.showErrorBox('dsh failed to start', text)
  app.exit(1)
}

/**
 * Run the desktop smoke assertions against the booted shell: the renderer saw
 * the boot graph and the preload bridge, one request crossed the IPC carrier,
 * and the profile mounted no web server. Ends the process with the verdict.
 * @param ctx - the booted profile root context.
 * @param window - the loaded shell window.
 */
async function runSmokeChecks(ctx: Context, window: BrowserWindow): Promise<void> {
  const failures: string[] = []
  const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
    if (!ok) failures.push(name)
  }
  // executeJavaScript resolves the page value over the wire: the booleans and
  // the invoke envelope are cast, not trusted — a wrong shape fails the check.
  const bootPresent = await window.webContents.executeJavaScript('Boolean(window.__DSH_BOOT__)') as boolean
  check('renderer window.__DSH_BOOT__ injected', bootPresent)
  const bridgePresent = await window.webContents.executeJavaScript(`(() => {
    const bridge = window.__DSH_IPC__
    return bridge !== undefined
      && ['fetch', 'openStream', 'closeStream', 'onServerRequest'].every(member => typeof bridge[member] === 'function')
  })()`) as boolean
  check('renderer window.__DSH_IPC__ exposes the four bridge members', bridgePresent)
  const windowBridgePresent = await window.webContents.executeJavaScript(`(() => {
    const bridge = window.__DSH_WINDOW__
    return bridge !== undefined
      && ['minimize', 'toggleMaximize', 'close', 'onStateChange'].every(member => typeof bridge[member] === 'function')
  })()`) as boolean
  check('renderer window.__DSH_WINDOW__ exposes the four window-control members', windowBridgePresent)
  let roundTrip = false
  try {
    const answer = await window.webContents.executeJavaScript(
      'window.__DSH_IPC__.fetch("/api/smoke-probe", { method: "GET", headers: {} })',
    ) as { status: unknown } | undefined
    roundTrip = answer !== undefined && typeof answer.status === 'number'
  } catch (error) {
    console.error(String(error))
  }
  check('dsh:fetch IPC carrier round-trip answered', roundTrip)
  check('profile mounts no webServer service', ctx.get('webServer') === undefined)
  console.log(failures.length === 0 ? 'dsh:electron smoke: PASS' : `dsh:electron smoke: FAIL (${failures.join(', ')})`)
  await ctx.fiber.dispose()
  app.exit(failures.length === 0 ? 0 : 1)
}

async function main(): Promise<void> {
  installProfileResolutionRetry()
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: PROFILE,
    patchFiles: [],
    args: [],
  })
  protocol.handle('dsh', request => handleDshProtocol(ctx, DIST_ROOT, request))
  if (ctx.get('hmr') === undefined) {
    // runProfile skips its watch-only HMR without the internal ESM loader
    // (unavailable under Electron) and logs through the tree logger; no
    // desktop row exports that logger, so the shell repeats the fact on its
    // own console. Restart applies cordis.patch.yml edits.
    console.warn('dsh:electron: live patch-layer reload unavailable; restart the app to apply cordis.patch.yml edits')
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    icon: ICON_PATH,
    // Frameless: the caption is the page itself (ui-layout's window band plus
    // the sidebar header as drag regions); resize edges and snap stay native.
    frame: false,
    webPreferences: { preload: PRELOAD_PATH, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // The custom caption's only privileged needs: the three operations and the
  // maximize state. `op` crosses the IPC wire, so the union is validated here.
  ipcMain.handle('dsh:window:operate', (_event, op: unknown) => {
    if (op === 'minimize') window.minimize()
    else if (op === 'close') window.close()
    else if (op === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else throw new Error(`dsh:window:operate: unknown op ${JSON.stringify(op)}`)
  })
  const sendWindowState = (): void => {
    window.webContents.send('dsh:window:state', { maximized: window.isMaximized() })
  }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)
  // The preload buffers whatever arrives before the page subscribes, so this
  // early push is not lost; without it the caption would guess its first icon.
  window.webContents.once('did-finish-load', sendWindowState)
  // The desktop shell never navigates away from its own surface; new windows
  // are refused outright.
  window.webContents.setWindowOpenHandler(() => denyNavigation(window))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault()
      denyNavigation(window)
    }
  })
  // The only interactive affordance beyond the page: a DevTools accelerator.
  window.webContents.on('before-input-event', (event, input) => {
    const toggle = input.type === 'keyDown'
      && ((input.control && input.shift && (input.key === 'I' || input.key === 'i')) || input.key === 'F12')
    if (!toggle) return
    event.preventDefault()
    window.webContents.toggleDevTools()
  })
  app.on('window-all-closed', () => { app.quit() })
  // Every quit path disposes the booted tree exactly once before the process
  // goes away; the retry after dispose passes the guard and lets quit finish.
  let disposed = false
  const disposeTree = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await ctx.fiber.dispose()
  }
  app.on('before-quit', (event) => {
    if (disposed) return
    event.preventDefault()
    void disposeTree().finally(() => { app.quit() })
  })
  await window.loadURL(`${APP_ORIGIN}/`)
  if (smoke) await runSmokeChecks(ctx, window)
}

function denyNavigation(window: BrowserWindow): { action: 'deny' } {
  if (!smoke) {
    void dialog.showMessageBox(window, { message: 'The dsh desktop app cannot navigate away from the app surface.', type: 'warning' })
  }
  return { action: 'deny' }
}

void app.whenReady().then(() => {
  main().catch(failLoud)
})

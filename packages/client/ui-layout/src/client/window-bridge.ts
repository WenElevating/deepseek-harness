/** The preload-injected Electron window-control bridge (wire boundary: shape is validated, not trusted). */

/** Maximize state of the desktop window. */
export interface WindowBridgeState {
  /** True while the window is maximized (the caption shows the restore glyph). */
  maximized: boolean
}

/** Minimal surface the preload exposes as window.__DSH_WINDOW__. */
export interface WindowBridge {
  /** Minimize the window to the taskbar. */
  minimize(): void
  /** Maximize or restore the window, whichever is not current. */
  toggleMaximize(): void
  /** Close the window (the app's window-all-closed path quits the process). */
  close(): void
  /**
   * Subscribe to maximize-state pushes; the preload replays its latest
   * buffered snapshot to each new subscriber before any later push.
   * @param listener - invoked with every state snapshot.
   * @returns unsubscribe function.
   */
  onStateChange(listener: (state: WindowBridgeState) => void): () => void
}

declare global {
  interface Window {
    /** Desktop-shell window-control bridge injected by the preload script; absent in plain browsers. */
    __DSH_WINDOW__?: WindowBridge
  }
}

const BRIDGE_KEY = '__DSH_WINDOW__'

/**
 * Read the desktop-shell window bridge; undefined outside it, loud on a malformed one.
 * @returns the validated bridge, or undefined when no preload injected one.
 * @throws when `window.__DSH_WINDOW__` is present but does not carry the four window-control members.
 */
export function readWindowBridge(): WindowBridge | undefined {
  const candidate = (globalThis as { [BRIDGE_KEY]?: unknown })[BRIDGE_KEY]
  if (candidate === undefined) return undefined
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('ui-layout: window.__DSH_WINDOW__ is present but not an object')
  }
  for (const member of ['minimize', 'toggleMaximize', 'close', 'onStateChange'] as const) {
    if (typeof (candidate as Record<string, unknown>)[member] !== 'function') {
      throw new Error(`ui-layout: window.__DSH_WINDOW__ is malformed (member ${JSON.stringify(member)})`)
    }
  }
  return candidate as WindowBridge
}

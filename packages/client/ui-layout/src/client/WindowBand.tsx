/**
 * Desktop caption band: the frameless Electron shell's window controls. A
 * browser gets nothing — no band, no inset, no document attribute — because
 * the whole feature keys on the preload-injected `window.__DSH_WINDOW__`
 * bridge (window-bridge.ts). Inside the shell the band is the drag region for
 * everything right of the sidebar (its left edge rides --dsh-frame-sidebar,
 * which AppFrame sets beside the grid tracks), the sidebar header carries the
 * drag region over its own column, and both activate through the one
 * data-dsh-window-frame attribute set here.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { readWindowBridge, type WindowBridgeState } from './window-bridge.ts'
import css from './WindowBand.module.css'

/** WindowBand props: the locale seat the root registration declares. */
export interface WindowBandProps {
  /** Translate a `layout`-namespace key (the caption's accessible names). */
  t: TranslateNS<'layout'>
}

/** Minimize glyph: one baseline rule. */
function IconMinimize10(): React.ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
      <path d="M0.5 5h9" stroke="currentColor" />
    </svg>
  )
}

/** Maximize glyph: one square outline. */
function IconMaximize10(): React.ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
    </svg>
  )
}

/** Restore glyph: the maximized square offset behind a front square. */
function IconRestore10(): React.ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
      <path d="M2.5 2.5V0.5h7v7h-2" stroke="currentColor" />
      <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" />
    </svg>
  )
}

/** Close glyph: the caption ×. */
function IconClose10(): React.ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" />
    </svg>
  )
}

/**
 * Render the caption band when the desktop bridge exists.
 * @param props - locale seat.
 * @returns the band element tree, or null outside the desktop shell.
 */
export function WindowBand({ t }: WindowBandProps) {
  // One read per mount: the preload injects the bridge before any page script
  // runs, so the value cannot change under the component.
  const bridge = useMemo(readWindowBridge, [])
  const [state, setState] = useState<WindowBridgeState | undefined>(undefined)
  useEffect(() => {
    if (bridge === undefined) return
    document.documentElement.dataset.dshWindowFrame = ''
    const unsubscribe = bridge.onStateChange(setState)
    return () => {
      delete document.documentElement.dataset.dshWindowFrame
      unsubscribe()
    }
  }, [bridge])
  if (bridge === undefined) return null
  return (
    <div className={css.band} data-dsh-window-band="">
      <button type="button" className={css.button} aria-label={t('window.minimize')} onClick={() => { bridge.minimize() }}>
        <IconMinimize10 />
      </button>
      <button
        type="button"
        className={css.button}
        aria-label={state?.maximized === true ? t('window.restore') : t('window.maximize')}
        onClick={() => { bridge.toggleMaximize() }}
      >
        {state?.maximized === true ? <IconRestore10 /> : <IconMaximize10 />}
      </button>
      <button
        type="button"
        className={`${css.button} ${css.close}`}
        aria-label={t('window.close')}
        onClick={() => { bridge.close() }}
      >
        <IconClose10 />
      </button>
    </div>
  )
}

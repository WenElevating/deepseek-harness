// @vitest-environment jsdom
/**
 * WindowBand spec: the preload bridge gates everything. Without
 * window.__DSH_WINDOW__ nothing renders and the document attribute stays off;
 * with it, the band mounts, marks the document root, wires the three
 * operations, follows maximize-state pushes (including the buffered replay a
 * new subscriber gets), and tears the attribute and subscription down on
 * unmount. readWindowBridge's own validation is covered against malformed
 * bridges.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WindowBand } from '@deepseek-ai/dsh-client-ui-layout/src/client/WindowBand.tsx'
import {
  readWindowBridge, type WindowBridge, type WindowBridgeState,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/window-bridge.ts'
// Type-only: pulls this package's LocaleNamespaceMap merge ('layout') into the
// program so the TranslateNS seat on WindowBandProps resolves concretely.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Recording fake mirroring the preload contract, including buffered replay. */
function fakeBridge(initial?: WindowBridgeState) {
  // Standalone vi.fn()s (not interface members) so assertions stay unbound-method clean.
  const ops = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }
  let latest = initial
  const listeners = new Set<(state: WindowBridgeState) => void>()
  const bridge: WindowBridge & { push(state: WindowBridgeState): void; subscribers(): number } = {
    ...ops,
    onStateChange: (listener) => {
      if (latest !== undefined) listener(latest)
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    push: (state) => {
      latest = state
      for (const listener of listeners) listener(state)
    },
    subscribers: () => listeners.size,
  }
  return { bridge, ops }
}

/** The t stub passes keys through, so aria-labels assert the dictionary keys. */
const t = (key: string): string => key

afterEach(() => {
  cleanup()
  delete (window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__
  delete document.documentElement.dataset.dshWindowFrame
})

describe('readWindowBridge', () => {
  it('returns undefined when no preload injected a bridge', () => {
    expect(readWindowBridge()).toBeUndefined()
  })

  it('throws on a non-object bridge', () => {
    (window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = 42
    expect(() => readWindowBridge()).toThrow('__DSH_WINDOW__')
  })

  it('throws when a member is missing', () => {
    (window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = { minimize: () => {} }
    // The first member present, the next one missing: the error names it.
    expect(() => readWindowBridge()).toThrow('toggleMaximize')
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = {
      minimize: () => {}, toggleMaximize: () => {}, close: () => {}, onStateChange: 'not a function',
    }
    expect(() => readWindowBridge()).toThrow('onStateChange')
  })

  it('returns the bridge when all four members are functions', () => {
    const { bridge } = fakeBridge()
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = bridge
    expect(readWindowBridge()).toBe(bridge)
  })
})

describe('WindowBand', () => {
  it('renders nothing without the bridge and leaves the document unmarked', () => {
    const { container } = render(<WindowBand t={t} />)
    expect(container.firstElementChild).toBe(null)
    expect(document.documentElement.hasAttribute('data-dsh-window-frame')).toBe(false)
  })

  it('mounts the three controls and marks the document root while bridged', () => {
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = fakeBridge().bridge
    const { container } = render(<WindowBand t={t} />)
    expect(container.querySelector('[data-dsh-window-band]')).not.toBe(null)
    expect(document.documentElement.hasAttribute('data-dsh-window-frame')).toBe(true)
    expect(screen.getByRole('button', { name: 'window.minimize' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'window.maximize' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'window.close' })).toBeTruthy()
  })

  it('each button drives its bridge operation', () => {
    const { bridge, ops } = fakeBridge()
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = bridge
    render(<WindowBand t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'window.minimize' }))
    expect(ops.minimize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'window.maximize' }))
    expect(ops.toggleMaximize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'window.close' }))
    expect(ops.close).toHaveBeenCalledTimes(1)
  })

  it('the maximize control follows state pushes: restore label and glyph after maximize', () => {
    const { bridge } = fakeBridge()
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = bridge
    render(<WindowBand t={t} />)
    expect(screen.queryByRole('button', { name: 'window.restore' })).toBe(null)
    act(() => { bridge.push({ maximized: true }) })
    expect(screen.getByRole('button', { name: 'window.restore' })).toBeTruthy()
    act(() => { bridge.push({ maximized: false }) })
    expect(screen.getByRole('button', { name: 'window.maximize' })).toBeTruthy()
  })

  it('replays the buffered snapshot to a late-mounting subscriber', () => {
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = fakeBridge({ maximized: true }).bridge
    render(<WindowBand t={t} />)
    expect(screen.getByRole('button', { name: 'window.restore' })).toBeTruthy()
  })

  it('unmount clears the document mark and unsubscribes', () => {
    const { bridge } = fakeBridge()
    ;(window as { __DSH_WINDOW__?: unknown }).__DSH_WINDOW__ = bridge
    const { unmount } = render(<WindowBand t={t} />)
    expect(bridge.subscribers()).toBe(1)
    unmount()
    expect(document.documentElement.hasAttribute('data-dsh-window-frame')).toBe(false)
    expect(bridge.subscribers()).toBe(0)
    expect(() => { bridge.push({ maximized: true }) }).not.toThrow()
  })
})

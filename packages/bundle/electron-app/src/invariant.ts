/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-electron-app`.
 * @module @deepseek-ai/dsh-electron-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-electron-app'

/** Cordis companion plugin name. */
export const name = 'electron-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns only a patch layer — the composition
 * invariants (HTTP family disabled, IPC carrier and Electron picker present,
 * web-runtime mounted for its webRuntime service) are asserted by the
 * composition spec against the real `loadProfile`/`composeEntries` path.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

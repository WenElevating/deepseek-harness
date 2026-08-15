/**
 * Package-owned invariant companion for the Electron IPC connection carrier.
 * @module @deepseek-ai/dsh-host-connection-electron/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-connection-electron'

/** Cordis companion plugin name. */
export const name = 'host-connection-electron-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the carrier owns no cross-plugin mutable relation —
 * ipcMain handlers and stream pumps are effects of the mounting fiber, and
 * their register/dispose symmetry is asserted by the carrier's own behavior
 * spec.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the Electron IPC carrier's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

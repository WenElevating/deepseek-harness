/** The invariant companion reserves package ownership and installs no runtime assertions. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as CarrierInvariant from '../src/invariant.ts'

describe('Electron connection-electron invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(CarrierInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-host-connection-electron', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

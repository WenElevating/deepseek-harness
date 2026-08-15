/** The invariant companion reserves package ownership and installs no runtime assertions. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PickerInvariant from '../src/invariant.ts'

describe('Electron directory-picker invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(PickerInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-host-directory-picker-electron', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

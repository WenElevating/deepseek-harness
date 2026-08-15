/** Argument composition for `dsh plugin`'s pnpm forwarding. */
import { describe, expect, it } from 'vitest'
import { withWorkspaceRootFlag } from '../src/plugin.ts'

describe('withWorkspaceRootFlag', () => {
  it('injects -w before root-checked verbs inside a workspace profile', () => {
    expect(withWorkspaceRootFlag(['add', 'dsh-x'], true)).toEqual(['-w', 'add', 'dsh-x'])
    expect(withWorkspaceRootFlag(['remove', 'dsh-x'], true)).toEqual(['-w', 'remove', 'dsh-x'])
  })

  it('leaves non-mutating verbs untouched even in a workspace', () => {
    expect(withWorkspaceRootFlag(['install'], true)).toEqual(['install'])
    expect(withWorkspaceRootFlag(['why', 'dsh-x'], true)).toEqual(['why', 'dsh-x'])
  })

  it('leaves every verb untouched without a workspace file', () => {
    expect(withWorkspaceRootFlag(['add', 'dsh-x'], false)).toEqual(['add', 'dsh-x'])
  })

  it('keeps trailing pnpm flags after the injected one', () => {
    expect(withWorkspaceRootFlag(['add', '-D', 'dsh-x'], true)).toEqual(['-w', 'add', '-D', 'dsh-x'])
  })
})

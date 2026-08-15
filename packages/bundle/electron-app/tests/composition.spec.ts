/** The electron profile composition: HTTP carrier family disabled, IPC carrier present. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadProfile, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

const INSTALL_ANCHOR = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))

function composedRows(): Map<string, { id?: unknown; disabled?: unknown; config?: unknown }> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-electron-'))
  const profile = loadProfile('dsh-test', 'electron', INSTALL_ANCHOR, home, { userLayer: false })
  const rows = new Map<string, { id?: unknown; disabled?: unknown; config?: unknown }>()
  for (const row of composeEntries(profile.layers.map(layer => layer.patches))) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  return rows
}

describe('electron profile composition', () => {
  it('lists base, web-app, then electron-app in the shipped template', () => {
    expect(PROFILE_TEMPLATES.electron).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-electron-app',
    ])
  })

  it('disables the HTTP family and inserts the electron rows', () => {
    const rows = composedRows()
    expect(rows.get('webserver')?.disabled).toBe(true)
    expect(rows.get('client-hmr')?.disabled).toBe(true)
    expect(rows.get('web-runtime')?.config).toMatchObject({ printUrl: false, surfaceContext: false })
    // connection 行注入 webRuntime，此行必须保持挂载：patch 无法改写 inject，禁用会让信任围栏悬空。
    expect(rows.get('web-runtime')?.disabled).not.toBe(true)
    expect(rows.get('directory-picker')?.disabled).toBe(true)
    expect(rows.has('connection-electron')).toBe(true)
    expect(rows.has('directory-picker-electron')).toBe(true)
    expect(rows.has('connection')).toBe(true)  // 客户端半边行保留
    expect(rows.get('connection')?.disabled).not.toBe(true)  // IPC 载体认领的宿主半边所在行必须启用
  })
})

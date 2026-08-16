/**
 * Package the dsh desktop shell into a shareable portable Windows directory
 * plus a zip. Layout: the prebuilt Electron runtime (node_modules/electron/dist)
 * with its exe renamed to the product name, and a `pnpm deploy`ed
 * self-contained application closure at `resources/app` — the classic
 * pre-asar app layout Electron loads without any packaging tool of its own.
 *
 * The deployed closure is flat real files (`--config.node-linker=hoisted`):
 * no symlink store to break when the zip is extracted, and the same
 * single-cordis-instance layout profiles use for out-of-tree plugins. The
 * `electron` npm package is pruned from the closure after deploy: the
 * packaged app runs AS Electron (the built-in import), never requires the
 * package, and the profile-module heal skips declared-but-missing
 * dependencies, so its absence is inert.
 *
 * Usage: node scripts/package-desktop.mjs [--skip-build] [--no-zip]
 * Requires a Windows host (exe rename + rcedit icon patch are win32-only).
 * @module package-desktop
 */

import { existsSync, rmSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP_DIR = join(REPO_ROOT, 'apps', 'electron')
const APP_MANIFEST = JSON.parse(await readFile(join(APP_DIR, 'package.json'), 'utf8'))
const PRODUCT_NAME = 'DeepSeek Harness'
const OUT_DIR = join(APP_DIR, 'release')
const STAGE_DIR = join(OUT_DIR, PRODUCT_NAME)
const SKIP_BUILD = process.argv.includes('--skip-build')
const NO_ZIP = process.argv.includes('--no-zip')

if (process.platform !== 'win32') {
  throw new Error('package-desktop: only win32 packaging is implemented (exe rename + rcedit); run on a Windows host')
}

// The app package resolves `electron` (its dist is the runtime we ship).
const appRequire = createRequire(join(APP_DIR, 'package.json'))
const electronDist = join(dirname(appRequire.resolve('electron')), 'dist')
if (!existsSync(join(electronDist, 'electron.exe'))) {
  throw new Error('package-desktop: electron dist not found — run pnpm install first')
}

/**
 * Map every `@deepseek-ai/*` workspace package name to its source directory:
 * packages/<group>/<pkg>, vendor/<pkg>, apps/<app>, and native/<pkg>. The
 * repair pass resolves by this map — vendored peers (cosmokit, cordis) are
 * not dependencies of any single anchor package, so require.resolve cannot
 * find them from one root.
 * @returns {Promise<Map<string, string>>} package name to absolute directory.
 */
async function workspacePackageMap() {
  const map = new Map()
  const collect = async (dir, depth) => {
    if (depth === 0) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        await collect(child, depth - 1)
        continue
      }
      if (entry.name !== 'package.json') continue
      const manifest = JSON.parse(await readFile(child, 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
        if (!map.has(manifest.name)) map.set(manifest.name, dirname(child))
      }
    }
  }
  for (const root of ['packages', 'vendor', 'apps', 'native']) {
    await collect(join(REPO_ROOT, root), root === 'packages' ? 3 : 2)
  }
  return map
}

/**
 * Copy `@deepseek-ai/*` packages the production deploy pruned but the built
 * lib output imports at runtime: several workspace packages classify their
 * runtime imports as devDependencies (invisible in the always-fully-installed
 * workspace, fatal in a --prod deploy). Walk every staged package's declared
 * dependency names; any missing `@deepseek-ai/*` name is resolved from the
 * workspace and copied in flat, iterating to a fixed point because each
 * repaired package can name more.
 * @param {string} deployStage - the deployed app directory (package.json + node_modules).
 * @returns {Promise<void>}
 */
async function repairClosure(deployStage) {
  const staged = join(deployStage, 'node_modules')
  const workspace = await workspacePackageMap()
  const namesOf = async (dir) => {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    return ['dependencies', 'devDependencies', 'peerDependencies']
      .flatMap(section => Object.keys(manifest[section] ?? {}))
      .filter(name => name.startsWith('@deepseek-ai/'))
  }
  // Seed with the app root and every staged @deepseek-ai package: the pruned
  // runtime names hide in ALREADY-deployed packages' devDependencies as much
  // as in repaired ones.
  const frontier = [deployStage]
  const scopeDir = join(staged, '@deepseek-ai')
  if (existsSync(scopeDir)) {
    for (const entry of await readdir(scopeDir)) frontier.push(join(scopeDir, entry))
  }
  let repaired = 0
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    for (const name of await namesOf(next)) {
      const target = join(staged, name)
      if (existsSync(target)) continue
      const source = workspace.get(name)
      if (source === undefined) {
        throw new Error(`package-desktop: staged package ${dirname(next)} needs ${name}, which is not a workspace package`)
      }
      await cp(source, target, { recursive: true })
      frontier.push(target)
      repaired += 1
    }
  }
  if (repaired > 0) console.log(`       repaired ${repaired} runtime-pruned package(s) into the closure`)
}

console.log(`[1/5] building the app and the web dist (skip with --skip-build)`)
if (!SKIP_BUILD) {
  await execa('pnpm', ['--filter', '@deepseek-ai/dsh-electron', 'run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' })
  await execa('pnpm', ['run', 'build:web'], { cwd: REPO_ROOT, stdio: 'inherit' })
} else {
  for (const artifact of ['lib/main.js', 'preload/index.cjs']) {
    if (!existsSync(join(APP_DIR, artifact))) {
      throw new Error(`package-desktop: apps/electron/${artifact} missing — drop --skip-build or build first`)
    }
  }
  if (!existsSync(join(APP_DIR, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'))) {
    throw new Error('package-desktop: web dist missing — drop --skip-build or run pnpm run build:web first')
  }
}

console.log(`[2/5] deploying the production closure into ${STAGE_DIR}/resources/app`)
rmSync(STAGE_DIR, { recursive: true, force: true })
// The temp deploy dir avoids pnpm refusing a target that already contains files.
const deployStage = await mkdtemp(join(tmpdir(), 'dsh-package-deploy-'))
try {
  await execa('pnpm', [
    '--filter', '@deepseek-ai/dsh-electron', 'deploy', '--prod', '--legacy',
    '--config.node-linker=hoisted', deployStage,
  ], { cwd: REPO_ROOT, stdio: 'inherit' })
  await rm(join(deployStage, 'node_modules', 'electron'), { recursive: true, force: true })
  await rm(join(deployStage, 'node_modules', '.pnpm'), { recursive: true, force: true })
  await repairClosure(deployStage)
  await cp(deployStage, join(STAGE_DIR, 'resources', 'app'), { recursive: true })
} finally {
  await rm(deployStage, { recursive: true, force: true }).catch(() => undefined)
}

console.log(`[3/5] copying the Electron runtime and renaming the entry exe`)
await cp(electronDist, STAGE_DIR, { recursive: true })
await rm(join(STAGE_DIR, 'resources', 'default_app.asar'), { force: true })
await rm(join(STAGE_DIR, 'electron.exe'), { force: true })
await cp(join(electronDist, 'electron.exe'), join(STAGE_DIR, `${PRODUCT_NAME}.exe`))

console.log(`[4/5] patching the exe icon and metadata (best effort)`)
// rcedit's FILEVERSION/PRODUCTVERSION fields require four numeric parts; a
// prerelease tag (`0.1.0-rc.5`) is normalized away, the strings keep it.
const [major = 0, minor = 0, patch = 0] = APP_MANIFEST.version.split('-')[0].split('.').map(Number)
const numericVersion = `${major}.${minor}.${patch}.0`
try {
  const { rcedit } = await import('rcedit')
  await rcedit(join(STAGE_DIR, `${PRODUCT_NAME}.exe`), {
    icon: join(APP_DIR, 'build', 'icon.ico'),
    'version-string': {
      ProductName: PRODUCT_NAME,
      FileDescription: 'DeepSeek Harness desktop shell',
      OriginalFilename: `${PRODUCT_NAME}.exe`,
      FileVersion: APP_MANIFEST.version,
      ProductVersion: APP_MANIFEST.version,
    },
    'file-version': numericVersion,
    'product-version': numericVersion,
  })
} catch (error) {
  console.warn(`package-desktop: rcedit skipped (${error instanceof Error ? error.message : String(error)}) — the exe keeps the generic Electron file icon; the running window still uses build/icon.png`)
}

if (NO_ZIP) {
  console.log(`[5/5] zip skipped (--no-zip)`)
} else {
  console.log(`[5/5] zipping the portable directory`)
  const zipPath = join(OUT_DIR, `deepseek-harness-desktop-${APP_MANIFEST.version}-win-x64.zip`)
  rmSync(zipPath, { force: true })
  // Compress-Archive follows junctions (none here — the closure is flat real
  // files), so the zip extracts to a runnable copy on any Windows box.
  await execa('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path ${JSON.stringify(join(STAGE_DIR, '*'))} -DestinationPath ${JSON.stringify(zipPath)}`,
  ], { cwd: REPO_ROOT })
  console.log(`zip: ${zipPath}`)
}

console.log(`portable directory: ${STAGE_DIR}`)
console.log(`share: unzip, then run "${PRODUCT_NAME}.exe"; first run initializes the profile under %USERPROFILE%\\.dsh`)

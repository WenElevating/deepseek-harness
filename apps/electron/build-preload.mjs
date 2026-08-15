// Sandboxed preloads must be one classic CJS file; esbuild is the repo-approved bundler.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'preload/index.cjs',
  external: ['electron'],
})

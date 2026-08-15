import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships `bin` plus the `./profile-boot` subpath the desktop shell
 * boots through: both are their own entries, so the desktop main process must
 * not pull the CLI dispatch along. The root tsdown builds only
 * `lib/types/index.js`, so this override points at the real entries instead;
 * reachable mode modules bundle with them. Declarations come from `tsc -b`
 * (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/profile-boot.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})

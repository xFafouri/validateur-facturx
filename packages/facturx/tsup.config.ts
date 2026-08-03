import { defineConfig } from 'tsup';

/**
 * Builds both ESM and CommonJS output.
 *
 * Consuming the raw TypeScript source works for bundlers but not for plain Node: the source uses
 * standards-correct `./foo.js` ESM specifiers, and Node resolves those literally against files
 * that are actually `.ts`. The NestJS API - CommonJS, run directly with `node` - fails outright.
 *
 * Emitting a real build fixes every consumer at once instead of asking each to work around it,
 * and dual format means the ESM web app and the CJS API can share one package honestly.
 */
export default defineConfig({
  // Two entry points. `browser` carries only the pure, `bigint`-backed modules, so the web app can
  // preview invoice totals with the same code that computes them for real without pulling
  // `node:fs` - and the whole PDF generator behind it - into a client bundle.
  entry: ['src/index.ts', 'src/browser.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  // Small surface, and tree-shaking keeps the French catalogue out of bundles that never use it.
  treeshake: true,
});

import { defineConfig } from 'tsup';

/** Dual ESM/CJS, for the same reason `@facturx/auth` is: the web app is ESM, the API is CJS. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  treeshake: true,
});

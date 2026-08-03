import { defineConfig } from 'tsup';

/**
 * Dual ESM/CJS, for the same reason `@facturx/core` is: the Next.js web app is ESM and the
 * NestJS API is CommonJS run directly under `node`, and both must be able to call this code.
 * Duplicating password and session handling into each app instead would mean two implementations
 * of the security-critical path, drifting apart at whatever rate the two apps are edited.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  treeshake: true,
});

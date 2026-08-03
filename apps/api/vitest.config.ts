import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild, vitest's default transformer, does not emit `design:paramtypes`. Nest's constructor
  // injection is built on exactly that metadata, so without an SWC pass a test that boots the
  // real application cannot resolve a single provider - and booting the real application is the
  // only way to catch a route that forgot its guard.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    // Issuance calls the validation engine and writes to Postgres; the default 5s is not enough
    // for a cold sidecar.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The suite shares one database, and the tests assert on rows they created. Running files in
    // parallel against one schema would make those assertions depend on scheduling.
    fileParallelism: false,
  },
});

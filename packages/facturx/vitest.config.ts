import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Schematron validation of a real invoice takes a few seconds, and the integration suite
    // waits on a container that may still be warming up.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

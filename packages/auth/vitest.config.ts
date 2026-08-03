import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // scrypt is deliberately slow, and the password suite hashes several times over.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

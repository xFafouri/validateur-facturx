import { defineConfig } from 'vitest/config';

export default defineConfig({
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

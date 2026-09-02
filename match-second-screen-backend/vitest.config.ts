import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only: everything here is a pure function or a module whose
    // I/O is stubbed. Nothing in this suite touches Redis, Postgres, the
    // fixture feed or an LLM, so `npm test` runs offline and deterministically.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure logic only — no DOM, no network. Component rendering would need a
    // browser environment and a testing library; the value here is in the
    // matching and layout rules that silently decide what a reader sees.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

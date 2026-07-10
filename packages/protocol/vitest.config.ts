import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'], // 纯 re-export，无可测逻辑
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});

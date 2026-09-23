import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@nora/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  test: { include: ['e2e/**/*.e2e.test.ts'], testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false },
});

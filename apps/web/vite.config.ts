import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.1.0';

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@nora/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  build: { target: 'es2020', sourcemap: true, cssCodeSplit: true },
  server: { host: true },
});

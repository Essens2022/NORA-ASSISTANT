import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.1.0';
// A short, unmistakably-different-per-deploy marker (git SHA + build time), shown on
// screen so it's obvious at a glance whether a device is running this build or a
// stale cached one - "0.1.0" alone never changes and can't tell the two apart.
const buildId = (() => {
  try {
    const sha = (process.env.GITHUB_SHA ?? execSync('git rev-parse --short HEAD').toString()).trim().slice(0, 7);
    return `${sha}-${new Date().toISOString().slice(11, 16).replace(':', '')}`;
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  // '/' for a root domain; '/<repo>/' for GitHub Pages project sites
  base: process.env.BASE_PATH || '/',
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(buildId) },
  resolve: { alias: { '@nora/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  build: { target: 'es2020', sourcemap: true, cssCodeSplit: true },
  server: { host: true },
});

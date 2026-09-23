// Copies the shared core into supabase/functions/_shared/core so the Edge
// Functions bundle contains it (the Supabase bundler only ships files under
// supabase/functions). Run automatically by `npm run functions:deploy`.
import { cpSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
const src = new URL('../packages/core/src/', import.meta.url);
const dst = new URL('../supabase/functions/_shared/core/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith('.ts')) cpSync(new URL(f, src), new URL(f, dst));
console.log('core synced →', dst.pathname);

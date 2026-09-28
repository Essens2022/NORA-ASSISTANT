// Scaffolds the Android (TWA) project from android/twa-manifest.json, without any
// interactive prompts - `bubblewrap init` always prompts (confirmed by reading its
// source: there is no non-interactive flag), so this calls the same @bubblewrap/core
// building blocks it uses internally, directly, to do the one thing CI actually needs:
// turn twa-manifest.json into a buildable Android project. `bubblewrap build` (run
// separately, after this) then compiles and signs it - that command IS documented to
// work non-interactively via BUBBLEWRAP_KEYSTORE_PASSWORD/BUBBLEWRAP_KEY_PASSWORD.
import { TwaManifest, TwaGenerator, ConsoleLog } from '@bubblewrap/core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const targetDir = here; // generate straight into android/, alongside twa-manifest.json

const manifest = await TwaManifest.fromFile(join(here, 'twa-manifest.json'));
const log = new ConsoleLog('generate-project');
const generator = new TwaGenerator();
await generator.createTwaProject(targetDir, manifest, log);
console.log('Android project generated in', targetDir);

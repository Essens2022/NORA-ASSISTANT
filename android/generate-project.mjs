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
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const targetDir = here; // generate straight into android/, alongside twa-manifest.json
const manifestFile = join(here, 'twa-manifest.json');

const manifest = await TwaManifest.fromFile(manifestFile);
const log = new ConsoleLog('generate-project');
const generator = new TwaGenerator();
await generator.createTwaProject(targetDir, manifest, log);

// `bubblewrap build` refuses to run unattended without this: with no checksum
// file, it stops to interactively ask "regenerate your project? (Y/n)" - which
// just hangs (exit 130) with no terminal attached, as seen on the first real CI
// run. This is exactly what `bubblewrap init` writes itself (same file name,
// same plain SHA-1 of the manifest's raw bytes - confirmed reading its source),
// just done here instead of inside that interactive command.
const sum = createHash('sha1').update(await readFile(manifestFile)).digest('hex');
await writeFile(join(targetDir, 'manifest-checksum.txt'), sum);

console.log('Android project generated in', targetDir);

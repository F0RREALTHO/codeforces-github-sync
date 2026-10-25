import { build as viteBuild } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../dist-edge/', import.meta.url));
await viteBuild({ mode: 'production', build: { outDir: output, emptyOutDir: true } });

const manifestPath = fileURLToPath(new URL('../dist-edge/manifest.json', import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3 || !manifest.key) {
  throw new Error('Expected the shared production MV3 manifest with its pinned key before Edge packaging.');
}

// Partner Center rejects Chromium's manifest key. The Edge store assigns the
// listing identity, which must be configured in OAuth after its ID is known.
delete manifest.key;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const verified = JSON.parse(await readFile(manifestPath, 'utf8'));
if ('key' in verified) throw new Error('Edge store build must not include a manifest key.');
console.log('Edge store build created at dist-edge/ without manifest.key.');

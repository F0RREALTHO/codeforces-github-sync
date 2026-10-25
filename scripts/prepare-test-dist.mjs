import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = new URL('../dist-test/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== 'background.js') {
  throw new Error('dist-test does not contain the expected MV3 extension manifest.');
}

manifest.name = 'Codeforces → GitHub Sync (Test)';
manifest.description = 'Isolated local test build for Codeforces → GitHub Sync.';
// Never give the local test build the production extension identity.
delete manifest.key;
manifest.optional_host_permissions = ['http://127.0.0.1/*'];

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

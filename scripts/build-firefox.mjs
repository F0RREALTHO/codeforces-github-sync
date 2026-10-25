import { build as viteBuild, loadEnv } from 'vite';
import { build as esbuild } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../dist-firefox/', import.meta.url));
await viteBuild({ mode: 'production', build: { outDir: output, emptyOutDir: true } });
const loaded = loadEnv('production', process.cwd(), 'VITE_');
const env = {
  VITE_GITHUB_APP_CLIENT_ID: process.env.VITE_GITHUB_APP_CLIENT_ID || loaded.VITE_GITHUB_APP_CLIENT_ID,
  VITE_GITHUB_APP_SLUG: process.env.VITE_GITHUB_APP_SLUG || loaded.VITE_GITHUB_APP_SLUG,
  VITE_AUTH_API_BASE_URL: process.env.VITE_AUTH_API_BASE_URL || loaded.VITE_AUTH_API_BASE_URL,
};
for (const name of ['VITE_GITHUB_APP_CLIENT_ID', 'VITE_GITHUB_APP_SLUG', 'VITE_AUTH_API_BASE_URL']) {
  if (!env[name] || /^REPLACE_/i.test(env[name])) {
    if (process.env.CI) {
      env[name] = `ci_dummy_${name.toLowerCase()}`;
    } else {
      throw new Error(`Production configuration is missing ${name}; check ignored .env.local.`);
    }
  }
}

// Firefox MV3 uses non-persistent background scripts (not service workers) and
// does not load ES-module background scripts. Bundle the background entry as one
// classic script while leaving the popup/dashboard chunks as Vite built them.
await esbuild({
  entryPoints: [fileURLToPath(new URL('../src/background/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist-firefox/background.js', import.meta.url)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'firefox128',
  legalComments: 'none',
  define: {
    'import.meta.env.VITE_GITHUB_APP_CLIENT_ID': JSON.stringify(env.VITE_GITHUB_APP_CLIENT_ID),
    'import.meta.env.VITE_GITHUB_APP_SLUG': JSON.stringify(env.VITE_GITHUB_APP_SLUG),
    'import.meta.env.VITE_AUTH_API_BASE_URL': JSON.stringify(env.VITE_AUTH_API_BASE_URL),
  },
});

const manifestPath = fileURLToPath(new URL('../dist-firefox/manifest.json', import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== 'background.js') {
  throw new Error('The shared production build did not contain the expected MV3 background entry.');
}
delete manifest.key;
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ['background.js'] };
manifest.browser_specific_settings = {
  gecko: {
    id: 'codeforces-github-sync@forrealtho',
    // Firefox's built-in data-collection disclosure is available from 140 on
    // desktop and 142 on Android. Keep one conservative floor so the manifest
    // never claims support where its required disclosure cannot be shown.
    strict_min_version: '142.0',
    data_collection_permissions: {
      required: ['authenticationInfo', 'websiteContent'],
    },
  },
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const background = await readFile(fileURLToPath(new URL('../dist-firefox/background.js', import.meta.url)), 'utf8');
if (/^\s*import\s/m.test(background) || !background.includes('runtime.onMessage')) {
  throw new Error('Firefox background output must be a bundled classic script with runtime listeners.');
}
console.log('Firefox MV3 build created at dist-firefox/.');

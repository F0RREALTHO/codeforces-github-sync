/** Resolve the browser's WebExtensions API at call time, so tests can stub it. */
export function browserApi(): typeof chrome {
  const api = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? globalThis.chrome;
  if (!api) throw new Error('This build must run as a browser extension.');
  return api;
}

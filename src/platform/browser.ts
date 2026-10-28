/** Check whether an object is a genuine WebExtensions API root (not Chromium's window.chrome stub on ordinary web pages). */
function isValidExtensionNamespace(candidate: unknown): candidate is typeof chrome {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as Record<string, unknown>;
  const hasRuntime = typeof c.runtime === 'object' && c.runtime !== null;
  const hasStorage = typeof c.storage === 'object' && c.storage !== null;
  const hasAlarms = typeof c.alarms === 'object' && c.alarms !== null;
  const hasIdentity = typeof c.identity === 'object' && c.identity !== null;
  return hasRuntime || hasStorage || hasAlarms || hasIdentity;
}

/** Resolve the browser's WebExtensions API at call time, so tests can stub it. */
export function browserApi(): typeof chrome {
  const g = globalThis as typeof globalThis & { browser?: typeof chrome };
  if (isValidExtensionNamespace(g.browser)) {
    return g.browser;
  }
  if (isValidExtensionNamespace(g.chrome)) {
    return g.chrome;
  }
  throw new Error('This build must run as a browser extension.');
}

/** Check if the current context has an active runtime communication channel. */
export function hasExtensionRuntime(): boolean {
  try {
    const api = browserApi();
    return typeof api?.runtime?.sendMessage === 'function';
  } catch {
    return false;
  }
}

/** Send a message to the background script with graceful connection failure handling. */
export async function sendRuntimeMessage<T = unknown>(message: unknown): Promise<T> {
  let api: typeof chrome;
  try {
    api = browserApi();
  } catch {
    throw new Error('Extension runtime connection is unavailable. Ensure you are running within the extension context.');
  }

  if (typeof api.runtime?.sendMessage !== 'function') {
    throw new Error('Extension messaging is not supported in this context.');
  }

  try {
    const response = (await api.runtime.sendMessage(message)) as { ok?: boolean; value?: T; error?: string } | undefined;
    if (response && typeof response === 'object' && 'ok' in response) {
      if (!response.ok) {
        throw new Error(response.error || 'The extension background worker reported an error.');
      }
      return response.value as T;
    }
    return response as T;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('Receiving end does not exist') || text.includes('Could not establish connection')) {
      throw new Error('Could not connect to the extension background worker. It may be waking up or updating. Please retry in a moment.');
    }
    throw error;
  }
}

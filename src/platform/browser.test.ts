import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserApi } from './browser';

afterEach(() => vi.unstubAllGlobals());

describe('cross-browser WebExtensions API selection', () => {
  it('uses Firefox browser namespace when available', () => {
    const firefox = { runtime: { id: 'firefox-addon-id' } } as unknown as typeof chrome;
    const chromium = { runtime: { id: 'chromium-id' } } as unknown as typeof chrome;
    vi.stubGlobal('browser', firefox);
    vi.stubGlobal('chrome', chromium);

    expect(browserApi()).toBe(firefox);
  });

  it('falls back to Chromium chrome namespace', () => {
    const chromium = { runtime: { id: 'chromium-id' } } as unknown as typeof chrome;
    vi.stubGlobal('chrome', chromium);

    expect(browserApi()).toBe(chromium);
  });

  it('fails clearly outside an extension runtime', () => {
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', undefined);

    expect(() => browserApi()).toThrow('This build must run as a browser extension.');
  });
});

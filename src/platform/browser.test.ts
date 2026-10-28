import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserApi, hasExtensionRuntime, sendRuntimeMessage } from './browser';

afterEach(() => vi.unstubAllGlobals());

describe('cross-browser WebExtensions API selection', () => {
  it('uses Firefox browser namespace when available', () => {
    const firefox = { runtime: { id: 'firefox-addon-id', sendMessage: vi.fn() } } as unknown as typeof chrome;
    const chromium = { runtime: { id: 'chromium-id', sendMessage: vi.fn() } } as unknown as typeof chrome;
    vi.stubGlobal('browser', firefox);
    vi.stubGlobal('chrome', chromium);

    expect(browserApi()).toBe(firefox);
    expect(hasExtensionRuntime()).toBe(true);
  });

  it('falls back to Chromium chrome namespace when browser is absent', () => {
    const chromium = { runtime: { id: 'chromium-id', sendMessage: vi.fn() } } as unknown as typeof chrome;
    vi.stubGlobal('chrome', chromium);

    expect(browserApi()).toBe(chromium);
    expect(hasExtensionRuntime()).toBe(true);
  });

  it('fails clearly outside an extension runtime when both are undefined', () => {
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', undefined);

    expect(() => browserApi()).toThrow('This build must run as a browser extension.');
    expect(hasExtensionRuntime()).toBe(false);
  });

  it('rejects Chromium web page chrome stub lacking runtime/storage', () => {
    // Normal web pages in Chrome, Brave, Edge expose a dummy window.chrome stub without runtime/storage
    const webPageStub = { app: { isInstalled: false } } as unknown as typeof chrome;
    vi.stubGlobal('chrome', webPageStub);
    vi.stubGlobal('browser', undefined);

    expect(() => browserApi()).toThrow('This build must run as a browser extension.');
    expect(hasExtensionRuntime()).toBe(false);
  });

  it('sends messages and extracts payload cleanly', async () => {
    const mockSend = vi.fn().mockResolvedValue({ ok: true, value: { hello: 'world' } });
    vi.stubGlobal('chrome', { runtime: { sendMessage: mockSend } });

    const result = await sendRuntimeMessage<{ hello: string }>({ type: 'test' });
    expect(result).toEqual({ hello: 'world' });
    expect(mockSend).toHaveBeenCalledWith({ type: 'test' });
  });

  it('handles background connection failure gracefully', async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    vi.stubGlobal('chrome', { runtime: { sendMessage: mockSend } });

    await expect(sendRuntimeMessage({ type: 'test' })).rejects.toThrow(
      'Could not connect to the extension background worker. It may be waking up or updating. Please retry in a moment.'
    );
  });

  it('handles non-extension context in sendRuntimeMessage gracefully', async () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);

    await expect(sendRuntimeMessage({ type: 'test' })).rejects.toThrow(
      'Extension runtime connection is unavailable. Ensure you are running within the extension context.'
    );
  });
});

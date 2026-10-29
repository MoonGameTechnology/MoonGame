import { describe, expect, it, vi } from 'vitest';
import { join, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import { SDK_STUB, START_URL, resolveRequest } from './routes.mjs';
import { createPlatform } from '../prototype/src/platform/host';

const ROOT = join(sep, 'opt', 'game', 'www');

describe('resolveRequest', () => {
  it('serves the start page and files under the web root', () => {
    expect(resolveRequest(START_URL, ROOT)).toEqual({
      kind: 'file',
      path: join(ROOT, 'index.html'),
      type: 'text/html; charset=utf-8',
    });
    expect(resolveRequest('app://game/', ROOT)).toMatchObject({ path: join(ROOT, 'index.html') });
    expect(resolveRequest('app://game/assets/locale-en.json?x=1', ROOT)).toEqual({
      kind: 'file',
      path: join(ROOT, 'assets', 'locale-en.json'),
      type: 'application/json; charset=utf-8',
    });
  });

  it('answers the Yandex loader path with the empty stub, not a 404', () => {
    expect(resolveRequest('app://game/sdk.js', ROOT)).toMatchObject({ kind: 'sdk-stub' });
  });

  it('the stub loader starts the game on the web adapter, silently', async () => {
    const window = {};
    runInNewContext(SDK_STUB, { window, Promise });
    expect(typeof window.YaGames?.init).toBe('function');
    const onSdkError = vi.fn();
    const platform = await createPlatform({ simulate: false, yaGames: window.YaGames, onSdkError });
    expect(platform.capabilities.auth).toBe(false);
    expect(platform.capabilities.rewardedAds).toBe(false);
    expect(platform.capabilities.iap).toBe(false);
    // "No platform" is a normal outcome, not an SDK failure: nothing goes to the error report.
    expect(onSdkError).not.toHaveBeenCalled();
  });

  it('never leaves the web root', () => {
    for (const url of [
      'app://game/../secret.txt',
      'app://game/%2e%2e/secret.txt',
      'app://game/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      'app://game/assets/..%5c..%5csecret.txt',
      'app://game/a%00.html',
      'app://game/%E0%A4%A',
    ]) {
      const route = resolveRequest(url, ROOT);
      if (route.kind === 'file') expect(route.path.startsWith(ROOT + sep)).toBe(true);
    }
    expect(resolveRequest('app://game/assets/%2e%2e%2f%2e%2e%2fsecret.txt', ROOT)).toEqual({
      kind: 'not-found',
    });
    expect(resolveRequest('app://game/a%00.html', ROOT)).toEqual({ kind: 'not-found' });
  });

  it('refuses other schemes and hosts', () => {
    expect(resolveRequest('file:///etc/passwd', ROOT)).toEqual({ kind: 'not-found' });
    expect(resolveRequest('app://other/index.html', ROOT)).toEqual({ kind: 'not-found' });
    expect(resolveRequest('not a url', ROOT)).toEqual({ kind: 'not-found' });
  });
});

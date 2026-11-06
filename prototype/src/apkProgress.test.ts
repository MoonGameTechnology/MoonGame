import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { installProgress, initApkUpdater } from './apkUpdate';

const check = vi.hoisted(() => vi.fn());
vi.mock('./updater', async (original) => ({
  ...(await original<typeof import('./updater')>()),
  isRuStoreBuild: () => false,
  currentBuild: () => ({ versionCode: 1, sha: 'deadbee' }),
  checkForUpdateDetailed: check,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setLocale('ru');
});

describe('measured APK download progress', () => {
  it.each(['ru', 'en'] as const)(
    'shows received bytes, percentage and distinct verification in %s',
    (locale) => {
      setLocale(locale);
      const half = installProgress({
        status: 'downloading',
        received: 15 * 1048576,
        total: 30 * 1048576,
      });
      expect(half.value).toBe(0.5);
      expect(half.message).toContain('50%');
      expect(half.message).toContain('15.0 / 30.0');
      expect(half.busy).toBe(true);
      expect(installProgress({ status: 'downloading', received: 30, total: 30 }).value).toBe(1);
      expect(installProgress('verifying')).toMatchObject({
        value: null,
        visible: true,
        busy: true,
      });
      expect(installProgress('verifying').message).not.toBe(half.message);
      expect(installProgress('installing')).toMatchObject({ value: 1, busy: false });
    },
  );
  it('does not invent a percentage for unknown lengths, old native bridges or invalid counters', () => {
    for (const total of [-1, 0, null, NaN, Infinity, 999999999, 2]) {
      const view = installProgress({ status: 'downloading', received: 10, total });
      expect(view.value).toBeNull();
      expect(view.message).not.toContain('%');
    }
    for (const received of [-1, NaN, Infinity, '10', 0.5, 999999999])
      expect(installProgress({ status: 'downloading', received, total: 30 }).value).toBeNull();
    expect(installProgress('downloading')).toMatchObject({
      value: null,
      visible: true,
      busy: true,
    });
    expect(installProgress('E_UPDATE_DIGEST')).toMatchObject({ visible: false, busy: false });
  });
});

class Node extends EventTarget {
  textContent = '';
  style: Record<string, string> = {};
  hidden = true;
  value = 0;
  attrs = new Map<string, string>();
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value);
  }
  removeAttribute(key: string) {
    this.attrs.delete(key);
  }
}

it('wires actual native events to the bar, blocks duplicate downloads, and resets on retry', async () => {
  const nodes = new Map(
    ['ub-go', 'ub-status', 'ub-progress', 'updbar'].map((id) => [id, new Node()]),
  );
  const win = new EventTarget();
  Object.assign(win, { setInterval: vi.fn(), setTimeout: vi.fn() });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    getElementById: (id: string) => nodes.get(id) ?? null,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { onLine: false });
  const install = vi.fn();
  vi.stubGlobal('VoidNative', { installVerified: install });
  check.mockResolvedValue({
    kind: 'update',
    local: 1,
    info: {
      apkUrl:
        'https://77-221-140-87.sslip.io/downloads/android/alpha/2-deadbee/void-dominion-alpha.apk',
      apkSha256: 'a'.repeat(64),
    },
  });
  initApkUpdater();
  const click = () => nodes.get('ub-go')!.dispatchEvent(new Event('click', { cancelable: true }));
  const report = (detail: unknown) =>
    win.dispatchEvent(new CustomEvent('void-apk-update', { detail }));
  click();
  await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  report({ status: 'downloading', received: 10, total: 40 });
  expect(nodes.get('ub-progress')).toMatchObject({ hidden: false, value: 0.25 });
  click();
  await Promise.resolve();
  expect(install).toHaveBeenCalledTimes(1);
  report('verifying');
  expect(nodes.get('ub-progress')!.attrs.has('value')).toBe(false);
  report('E_UPDATE_DOWNLOAD');
  expect(nodes.get('ub-progress')!.hidden).toBe(true);
  expect(nodes.get('ub-go')!.attrs.get('aria-disabled')).toBe('false');
  click();
  await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
  expect(nodes.get('ub-status')!.textContent).not.toContain('25%');
  report({ status: 'downloading', received: 0, total: 40 });
  expect(nodes.get('ub-progress')!.value).toBe(0);
  report('installing');
  expect(nodes.get('ub-progress')!.value).toBe(1);
});

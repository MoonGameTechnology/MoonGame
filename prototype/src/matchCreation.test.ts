import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSession } from '../../decisions/sessionStore';
import * as creation from './matchCreation';

const BASE = 'wss://game.test';
const response = (canCreate: unknown, status = 200) => ({ status, json: async () => ({ canCreate }) });
let server: { base: string; nick: string } | null;
let cell: Map<string, string>;
let controls: Map<string, { style: { display: string }; disabled: boolean }>;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  server = { base: BASE, nick: 'Creator' };
  cell = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => cell.get(key) ?? null,
    setItem: (key: string, value: string) => cell.set(key, value),
    removeItem: (key: string) => cell.delete(key),
  });
  saveSession(localStorage, BASE, { login: 'Creator', token: 'S1' });
  controls = new Map(['setup-network-create', 'match-create-go', 'match-create']
    .map(id => [id, { style: { display: '' }, disabled: false }]));
  vi.stubGlobal('document', { getElementById: (id: string) => controls.get(id) ?? null });
  fetcher = vi.fn(async () => response(true));
  vi.stubGlobal('fetch', fetcher);
  creation.initMatchCreation(() => server);
});
afterEach(() => { vi.unstubAllGlobals(); });

const hidden = () => {
  expect(creation.canCreateOnlineMatch()).toBe(false);
  expect(controls.get('setup-network-create')!.style.display).toBe('none');
  expect(controls.get('setup-network-create')!.disabled).toBe(true);
  expect(controls.get('match-create')!.style.display).toBe('none');
  expect(controls.get('match-create-go')!.disabled).toBe(true);
};

describe('session creation controls', () => {
  it('starts hidden, asks with the selected login token, and preserves browser tab visibility', async () => {
    hidden();
    await creation.refreshMatchCreation();
    expect(fetcher).toHaveBeenCalledWith('https://game.test/matches/capabilities', expect.objectContaining({
      headers: { authorization: 'Bearer S1' },
    }));
    expect(creation.canCreateOnlineMatch()).toBe(true);
    expect(controls.get('setup-network-create')!.style.display).toBe('');
    expect(controls.get('match-create-go')!.disabled).toBe(false);
    expect(controls.get('match-create')!.style.display).toBe('none');
  });
  it.each([[false, 200], ['true', 200], [true, 401], [true, 403], [true, 404], [true, 503]])(
    'removes a prior grant on refused or malformed response (%s, %s)', async (allowed, status) => {
      await creation.refreshMatchCreation();
      fetcher.mockResolvedValue(response(allowed, status as number));
      await creation.refreshMatchCreation();
      hidden();
    },
  );
  it('leaves controls hidden when the server or JSON is unavailable', async () => {
    await creation.refreshMatchCreation();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await creation.refreshMatchCreation();
    hidden();
    fetcher.mockResolvedValueOnce({ status: 200, json: async () => { throw new Error('invalid JSON'); } });
    await creation.refreshMatchCreation();
    hidden();
  });
  it('keeps a confirmed card stable during polling, then hides it on revocation', async () => {
    await creation.refreshMatchCreation();
    controls.get('match-create')!.style.display = '';
    let finish!: (value: ReturnType<typeof response>) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = creation.refreshMatchCreation();
    expect(controls.get('match-create')!.style.display).toBe('');
    finish(response(false));
    await pending;
    hidden();
  });
  it('does not transfer a grant to another login or refreshed token', async () => {
    await creation.refreshMatchCreation();
    const old = creation.matchCreator()!;
    saveSession(localStorage, BASE, { login: 'Creator', token: 'S2' });
    expect(creation.isCurrentMatchCreator(old)).toBe(false);
    await creation.refreshMatchCreation();
    expect(creation.canCreateOnlineMatch()).toBe(true);
    server = { base: BASE, nick: 'Another' };
    expect(creation.canCreateOnlineMatch()).toBe(false);
  });
  it.each(['account', 'server', 'logout'])('ignores an old grant after changing %s', async change => {
    let finish!: (value: ReturnType<typeof response>) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = creation.refreshMatchCreation();
    if (change === 'account') {
      server = { base: BASE, nick: 'Another' };
      saveSession(localStorage, BASE, { login: 'Another', token: 'S2' });
    } else if (change === 'server') server = { base: 'wss://another.test', nick: 'Creator' };
    else creation.forgetMatchCreation();
    finish(response(true));
    await pending;
    hidden();
  });
  it('an older successful request cannot override a newer refusal', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = creation.refreshMatchCreation();
    fetcher.mockResolvedValueOnce(response(false));
    await creation.refreshMatchCreation();
    finish(response(true));
    await old;
    hidden();
  });
  it('does not query without a selected server', async () => {
    server = null;
    await creation.refreshMatchCreation();
    expect(fetcher).not.toHaveBeenCalled();
    hidden();
  });
});

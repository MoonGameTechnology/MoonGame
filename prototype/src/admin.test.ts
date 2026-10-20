import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Node {
  value = '';
  textContent = '';
  style = { display: '' };
  onsubmit: ((event: { preventDefault(): void }) => void) | null = null;
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  append(): void {}
}

const SESSION_KEY = 'vd.admin.session';
const ORIGIN = 'https://admin.test';
const REMOTE = 'https://game.test';
const TOKEN = 'admin-session-test';
let nodes: Map<string, Node>;
let storage: Map<string, string>;
let requests: Array<{ url: string; authorization?: string }>;
let respond: (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;

function el(id: string): Node {
  if (!nodes.has(id)) nodes.set(id, new Node());
  return nodes.get(id)!;
}

function reply(status: number, body: unknown): { status: number; json(): Promise<unknown> } {
  return { status, json: async () => body };
}

async function signIn(base = REMOTE): Promise<void> {
  el('a-server').value = base;
  el('a-login').value = 'Commander';
  el('a-pass').value = 'a private passphrase';
  el('a-gate').onsubmit!({ preventDefault: () => {} });
  await vi.waitFor(() => expect(el('a-panel').style.display).toBe('block'));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  nodes = new Map();
  storage = new Map();
  requests = [];
  el('a-panel').style.display = 'none';
  respond = async (url) =>
    url.endsWith('/auth/login')
      ? reply(200, { token: TOKEN })
      : url.endsWith('/admin/whoami')
        ? reply(200, { login: 'Commander' })
        : reply(200, { available: [], active: [], archived: [] });
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('location', { origin: ORIGIN, protocol: 'https:' });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal('fetch', async (url: string, init: { headers?: { authorization?: string } }) => {
    requests.push({ url, authorization: init.headers?.authorization });
    return respond(url);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('admin credentials are bound to the authenticated server', () => {
  it('does not send the old bearer to a different server from the refresh timer', async () => {
    await import('./admin');
    await signIn();
    expect(requests.some((r) => r.url === `${REMOTE}/admin/whoami` && r.authorization === `Bearer ${TOKEN}`)).toBe(true);
    el('a-match').value = 'match-1';
    el('a-server').value = 'https://other.test';
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.filter((r) => r.url.startsWith('https://other.test') && r.authorization)).toEqual([]);
    expect(el('a-panel').style.display).toBe('none');
  });

  it('never restores an old unbound token against the hosting origin', async () => {
    storage.set(SESSION_KEY, TOKEN);
    await import('./admin');
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toEqual([]);
    expect(storage.has(SESSION_KEY)).toBe(false);
  });

  it('restores a scoped session only against the server that issued it', async () => {
    storage.set(SESSION_KEY, JSON.stringify({ base: REMOTE, token: TOKEN }));
    await import('./admin');
    await vi.waitFor(() => expect(el('a-panel').style.display).toBe('block'));
    expect(requests[0]).toEqual({ url: `${REMOTE}/admin/whoami`, authorization: `Bearer ${TOKEN}` });
    expect(el('a-server').value).toBe(REMOTE);
  });

  it('discards a login response if the server field changed while it was pending', async () => {
    let finish: (value: ReturnType<typeof reply>) => void = () => {};
    const pending = new Promise<ReturnType<typeof reply>>((resolve) => { finish = resolve; });
    respond = async () => pending;
    await import('./admin');
    el('a-server').value = REMOTE;
    el('a-gate').onsubmit!({ preventDefault: () => {} });
    el('a-server').value = 'https://other.test';
    finish(reply(200, { token: TOKEN }));
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    expect(storage.has(SESSION_KEY)).toBe(false);
    expect(el('a-panel').style.display).toBe('none');
  });
});

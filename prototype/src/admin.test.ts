import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../localization/runtime';

class Node {
  value = '';
  checked = false;
  className = '';
  style = { display: '' };
  children: Node[] = [];
  onsubmit: ((event: { preventDefault(): void }) => void) | null = null;
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  #text = '';
  get textContent(): string {
    return this.#text;
  }
  /** Как у DOM: текст заменяет детей. */
  set textContent(text: string) {
    this.#text = text;
    this.children = [];
  }
  append(...nodes: Node[]): void {
    this.children.push(...nodes);
  }
}

function find(node: Node, match: (n: Node) => boolean): Node | undefined {
  if (match(node)) return node;
  for (const child of node.children) {
    const hit = find(child, match);
    if (hit) return hit;
  }
  return undefined;
}

const SESSION_KEY = 'vd.admin.session';
const ORIGIN = 'https://admin.test';
const REMOTE = 'https://game.test';
const TOKEN = 'admin-session-test';
let nodes: Map<string, Node>;
let storage: Map<string, string>;
let requests: Array<{ url: string; authorization?: string }>;
let sent: Array<{ url: string; method: string; body?: string }>;
let respond: (url: string, method: string) => Promise<{ status: number; json(): Promise<unknown> }>;

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
  sent = [];
  el('a-panel').style.display = 'none';
  respond = async (url) =>
    url.endsWith('/auth/login')
      ? reply(200, { token: TOKEN })
      : url.endsWith('/admin/whoami')
        ? reply(200, { login: 'Commander' })
        : reply(200, { available: [], active: [], archived: [] });
  vi.stubGlobal('document', { getElementById: el, createElement: () => new Node() });
  vi.stubGlobal('location', { origin: ORIGIN, protocol: 'https:' });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal(
    'fetch',
    async (url: string, init: { method?: string; body?: string; headers?: { authorization?: string } }) => {
      requests.push({ url, authorization: init.headers?.authorization });
      sent.push({ url, method: init.method ?? 'GET', body: init.body });
      return respond(url, init.method ?? 'GET');
    },
  );
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

describe('объявления ленты (CORP-2)', () => {
  const posts = (url: string): Array<{ url: string; method: string; body?: string }> =>
    sent.filter((r) => r.method === 'POST' && r.url === url);

  it('публикует объявление на двух языках и очищает форму', async () => {
    await import('./admin');
    await signIn();
    respond = async (url, method) =>
      method === 'POST' && url.endsWith('/admin/news')
        ? reply(201, { ok: true })
        : reply(200, { announcements: [] });
    el('a-news-kind').value = 'tech';
    el('a-news-pin').checked = true;
    el('a-news-title-ru').value = ' Техработы ';
    el('a-news-title-en').value = 'Maintenance';
    el('a-news-body-ru').value = 'Сервер перезапустится.';
    el('a-news-form').onsubmit!({ preventDefault: () => {} });
    await vi.waitFor(() => expect(el('a-status').textContent).toBe(t('admin.news.published')));
    const [post] = posts(`${REMOTE}/admin/news`);
    expect(JSON.parse(post!.body!)).toEqual({
      kind: 'tech',
      pinned: true,
      until: null,
      title: { ru: 'Техработы', en: 'Maintenance' },
      body: { ru: 'Сервер перезапустится.', en: '' },
    });
    expect(el('a-news-title-ru').value).toBe('');
    expect(el('a-news-pin').checked).toBe(false);
  });

  it('без русского заголовка и с прошедшим сроком — не отправляет', async () => {
    await import('./admin');
    await signIn();
    el('a-news-form').onsubmit!({ preventDefault: () => {} });
    await vi.advanceTimersByTimeAsync(1);
    expect(el('a-status').textContent).toBe(t('admin.news.need-title'));
    el('a-news-title-ru').value = 'Заголовок';
    el('a-news-until').value = '2000-01-01T00:00';
    el('a-news-form').onsubmit!({ preventDefault: () => {} });
    await vi.advanceTimersByTimeAsync(1);
    expect(el('a-status').textContent).toBe(t('admin.news.bad-until'));
    expect(posts(`${REMOTE}/admin/news`)).toEqual([]);
  });

  it('снимает объявление только после подтверждения', async () => {
    const announcement = {
      id: 'n1',
      at: 1,
      kind: 'update',
      pinned: false,
      until: null,
      title: { ru: 'Обновление', en: '' },
      body: { ru: '', en: '' },
    };
    respond = async (url) =>
      url.endsWith('/auth/login')
        ? reply(200, { token: TOKEN })
        : url.endsWith('/admin/whoami')
          ? reply(200, { login: 'Commander' })
          : url.endsWith('/admin/news')
            ? reply(200, { announcements: [announcement] })
            : url.endsWith('/admin/news/n1/remove')
              ? reply(200, { ok: true })
              : reply(200, { available: [], active: [], archived: [] });
    let answer = false;
    vi.stubGlobal('confirm', () => answer);
    await import('./admin');
    await signIn();
    await vi.waitFor(() => expect(el('a-news-list').children).toHaveLength(1));
    const remove = find(el('a-news-list'), (n) => n.className === 'kick')!;
    remove.onclick!();
    await vi.advanceTimersByTimeAsync(1);
    expect(posts(`${REMOTE}/admin/news/n1/remove`)).toEqual([]);
    answer = true;
    remove.onclick!();
    await vi.waitFor(() => expect(el('a-status').textContent).toBe(t('admin.news.removed')));
    expect(posts(`${REMOTE}/admin/news/n1/remove`)).toHaveLength(1);
  });
});

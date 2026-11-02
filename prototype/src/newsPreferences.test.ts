import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsPreferenceStore } from './newsPreferences';
import { followNewsCorp } from '../../decisions/newsPreferences';

afterEach(() => vi.unstubAllGlobals());

describe('local news preferences', () => {
  it('delivers a pending directory to the current settings panel after a rerender', async () => {
    let finish: (response: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const store = new NewsPreferenceStore({ identity: () => 'alice',
      authorizedBase: async () => ({ base: 'https://game.test', token: 'test' }), changed: () => {} });
    const panel = () => {
      const directory = { innerHTML: '' };
      const node = { isConnected: true, addEventListener: () => {},
        querySelector: (selector: string) => selector === '[data-news-directory]' ? directory :
          { innerHTML: '', addEventListener: () => {} } };
      return { directory, node, root: { querySelector: () => node } as unknown as HTMLElement };
    };
    store.html();
    const first = panel(), current = panel();
    store.mount(first.root);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    first.node.isConnected = false;
    store.mount(current.root);
    finish({ ok: true, json: async () => ({ corps: [{ corpId: 'b', name: 'Beta', influence: 2, members: 3 }] }) });
    await vi.waitFor(() => expect(current.directory.innerHTML).toContain('Beta'));
    expect(first.directory.innerHTML).toBe('');
  });

  it('persists by account and server, while unavailable storage still works in memory', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    });
    let identity = 'server-a.alice';
    const host = { identity: () => identity, authorizedBase: async () => null, changed: vi.fn() };
    const store = new NewsPreferenceStore(host);
    store.save(followNewsCorp(store.get(), { id: 'b', name: 'Beta' }, true));
    expect(new NewsPreferenceStore(host).get().following).toHaveLength(1);
    identity = 'server-a.bob';
    expect(store.get().following).toEqual([]);
    identity = 'server-b.alice';
    expect(store.get().following).toEqual([]);
    identity = 'server-a.alice';
    expect(store.get().following[0]?.id).toBe('b');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('full');
      },
    });
    const memory = new NewsPreferenceStore(host);
    memory.save({ ...memory.get(), own: false });
    expect(memory.get().own).toBe(false);
  });

  it('recovers from damaged storage and escapes corporation names in settings', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{', setItem: () => {} });
    const store = new NewsPreferenceStore({
      identity: () => 'test',
      authorizedBase: async () => null,
      changed: () => {},
    });
    store.save(followNewsCorp(store.get(), { id: '" onclick="bad', name: '<img src=x>' }, true));
    expect(store.html()).toContain('&lt;img src=x&gt;');
    expect(store.html()).not.toContain('<img');
    expect(store.html()).not.toContain('" onclick="');
  });
});

import { describe, expect, it } from 'vitest';
import {
  activateShell,
  installShell,
  respond,
  shellKey,
  CACHE_PREFIX,
  type CacheLike,
  type CacheStorageLike,
  type ShellDeps,
} from './swCore';

/**
 * CP2.2 — поведение оболочки, проверенное без браузера.
 *
 * Кэш и сеть подставлены (тот же приём, что у `session.ts`): иначе этот код
 * проверялся бы только вручную, на живой сборке за живым HTTPS, то есть никогда.
 */
const SCOPE = 'https://play.example.com/';

function fakeCaches(seed: Record<string, Record<string, string>> = {}): {
  caches: CacheStorageLike;
  stores: Map<string, Map<string, Response>>;
} {
  const stores = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(seed)) {
    stores.set(name, new Map(Object.entries(entries).map(([k, v]) => [k, new Response(v)])));
  }
  const open = async (name: string): Promise<CacheLike> => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: (request) => Promise.resolve(store.get(request)),
      put: (request, response) => {
        store.set(request, response);
        return Promise.resolve();
      },
      addAll: (requests) => {
        for (const r of requests) store.set(r, new Response(`fetched:${r}`));
        return Promise.resolve();
      },
    };
  };
  return {
    stores,
    caches: {
      open,
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name) => Promise.resolve(stores.delete(name)),
    },
  };
}

const req = (url: string, mode = 'cors'): Request =>
  ({ method: 'GET', mode, url }) as unknown as Request;

function deps(over: Partial<ShellDeps> = {}): ShellDeps {
  return {
    caches: fakeCaches().caches,
    fetch: () => Promise.reject(new Error('offline')),
    scope: SCOPE,
    build: 'b1',
    precache: ['index.html', 'assets/main-X.js'],
    cacheable: ['index.html', 'assets/main-X.js', 'assets/ru-Y.js'],
    ...over,
  };
}

describe('оболочка приложения (CP2.2)', () => {
  it('установка кладёт файлы сборки под АБСОЛЮТНЫМИ адресами', async () => {
    const { caches, stores } = fakeCaches();
    const d = deps({ caches });
    await installShell(d);
    expect([...(stores.get(CACHE_PREFIX + 'b1') ?? new Map()).keys()]).toEqual([
      SCOPE + 'index.html',
      SCOPE + 'assets/main-X.js',
    ]);
  });

  it('активация сносит кэши прошлых сборок и не трогает чужие', async () => {
    const { caches, stores } = fakeCaches({
      [CACHE_PREFIX + 'b0']: { a: '1' },
      [CACHE_PREFIX + 'b1']: { b: '2' },
      'someone-else': { c: '3' },
    });
    await activateShell(deps({ caches }));
    expect([...stores.keys()].sort()).toEqual(['someone-else', CACHE_PREFIX + 'b1'].sort());
  });

  it('ассет отдаётся из кэша БЕЗ сети — это и есть мгновенный второй запуск', async () => {
    const { caches } = fakeCaches({
      [CACHE_PREFIX + 'b1']: { [SCOPE + 'assets/main-X.js']: 'app' },
    });
    let fetched = 0;
    const d = deps({
      caches,
      fetch: () => {
        fetched++;
        return Promise.resolve(new Response('fresh'));
      },
    });
    const res = await respond(d, req(SCOPE + 'assets/main-X.js'), 'asset');
    expect(await res.text()).toBe('app');
    expect(fetched).toBe(0);
  });

  it('промах по ассету идёт в сеть и запоминается', async () => {
    const { caches, stores } = fakeCaches();
    const d = deps({ caches, fetch: () => Promise.resolve(new Response('app')) });
    const res = await respond(d, req(SCOPE + 'assets/main-X.js'), 'asset');
    expect(await res.text()).toBe('app');
    expect(stores.get(CACHE_PREFIX + 'b1')?.has(SCOPE + 'assets/main-X.js')).toBe(true);
  });

  it('неудачный ответ не запоминается — иначе ошибка осталась бы навсегда', async () => {
    const { caches, stores } = fakeCaches();
    const d = deps({
      caches,
      fetch: () => Promise.resolve(new Response('nope', { status: 404 })),
    });
    const res = await respond(d, req(SCOPE + 'assets/main-X.js'), 'asset');
    expect(res.status).toBe(404);
    expect(stores.get(CACHE_PREFIX + 'b1')?.size ?? 0).toBe(0);
  });

  it('переход идёт в сеть ПЕРВЫМ делом — новая сборка должна доезжать', async () => {
    const { caches, stores } = fakeCaches({
      [CACHE_PREFIX + 'b1']: { [shellKey(SCOPE)]: 'старая оболочка' },
    });
    const d = deps({ caches, fetch: () => Promise.resolve(new Response('свежая оболочка')) });
    const res = await respond(d, req(SCOPE, 'navigate'), 'shell');
    expect(await res.text()).toBe('свежая оболочка');
    // И она же становится тем, что покажется офлайн в следующий раз.
    expect(
      await stores
        .get(CACHE_PREFIX + 'b1')
        ?.get(shellKey(SCOPE))
        ?.text(),
    ).toBe('свежая оболочка');
  });

  it('без сети переход отдаёт сохранённую оболочку — по ЛЮБОМУ адресу', async () => {
    const { caches } = fakeCaches({
      [CACHE_PREFIX + 'b1']: { [shellKey(SCOPE)]: 'оболочка' },
    });
    const d = deps({ caches });
    // Глубокая ссылка `?join=…` — тот же документ, а не отдельная запись кэша.
    const res = await respond(d, req(SCOPE + '?join=wss%3A%2F%2Fhost', 'navigate'), 'shell');
    expect(await res.text()).toBe('оболочка');
  });

  it('без сети и без кэша ошибка сети не проглатывается', async () => {
    await expect(respond(deps(), req(SCOPE, 'navigate'), 'shell')).rejects.toThrow('offline');
  });
});

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import {
  originLabel,
  arsenalItemName,
  arsenalCardHtml,
  arsenalPanelHtml,
  initArsenal,
  type ArsenalHost,
} from './arsenalScreen';

// REFM-5: locale pinned RU (see format.test.ts — under Node there is no browser
// language, so the runtime would fall back to EN and the name assertions would drift).
beforeAll(() => setLocale('ru'));

const hull: ArsenalItem = {
  itemId: 'starter:acc:hull:cruiser',
  kind: 'hull',
  form: 'blueprint',
  defId: 'cruiser',
  soulbound: true,
  origin: 'starter',
  acquiredAt: 0,
};
const gradedModule: ArsenalItem = {
  itemId: 'drop:acc:module:laser',
  kind: 'module',
  form: 'instance',
  defId: 'laser',
  grade: 2,
  durability: 40,
  soulbound: false,
  origin: 'drop',
  acquiredAt: 10,
};
const fitting: ArsenalItem = {
  itemId: 'craft:acc:fit:visor',
  kind: 'hero_fitting',
  form: 'blueprint',
  defId: 'visor',
  soulbound: false,
  origin: 'craft',
  acquiredAt: 5,
};

/** Node has no DOM — the витрина only ever paints innerHTML and delegates clicks, so
 *  a two-field stand-in is the whole contract. */
function fakeRoot(): HTMLElement & { html: () => string; fire: (target: unknown) => void } {
  let handler: ((ev: unknown) => void) | null = null;
  const el = {
    innerHTML: '',
    addEventListener: (_type: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    html: () => el.innerHTML,
    fire: (target: unknown) => handler?.({ target }),
  };
  return el as unknown as HTMLElement & { html: () => string; fire: (t: unknown) => void };
}

function hostOf(over: Partial<ArsenalHost> = {}): ArsenalHost {
  return {
    root: () => fakeRoot(),
    readCache: () => [],
    writeCache: () => {},
    openCodex: () => {},
    authorizedBase: () => Promise.resolve(null),
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('арсенал — карточка предмета', () => {
  it('корпус читается как юнит, модуль и фитинг — по своим каталогам', () => {
    expect(arsenalItemName(hull)).toBe('Крейсер');
    expect(arsenalItemName({ ...gradedModule, defId: 'cargo_bay' })).toBe('Грузовой отсек');
    expect(arsenalItemName({ ...fitting, defId: 'psi_amplifier' })).toBe('Пси-усилитель');
  });

  it('незнакомый defId не роняет карточку — уходит как есть', () => {
    // коллекция приходит с сервера и может опережать контент клиента
    expect(arsenalItemName(gradedModule)).toBe('laser');
    expect(arsenalItemName(fitting)).toBe('visor');
  });

  it('каждый вид ведёт на СВОЮ страницу кодекса', () => {
    expect(arsenalCardHtml(hull)).toContain('data-codex="u:cruiser"');
    expect(arsenalCardHtml(gradedModule)).toContain('data-codex="md:laser"');
    expect(arsenalCardHtml(fitting)).toContain('data-codex="hf:visor"');
  });

  it('бейджи показываются только когда есть что показывать', () => {
    expect(arsenalCardHtml(gradedModule)).toContain('+2 ⛭40 · ');
    // чертёж без заточки и износа: подпись — один «откуда», без ведущего разделителя
    const card = arsenalCardHtml(hull);
    expect(card).not.toContain('⛭');
    expect(card).toContain(`<span class="ar-meta">${originLabel('starter')}</span>`);
  });

  it('defId экранируется — коллекция приходит с сервера (CWE-79)', () => {
    const evil: ArsenalItem = { ...hull, defId: 'x" onclick="alert(1)' };
    const html = arsenalCardHtml(evil);
    expect(html).toContain('&quot;');
    expect(html).not.toContain('onclick="alert');
  });

  it('у всех шести источников есть подпись — ключ наружу не течёт', () => {
    for (const o of ['starter', 'drop', 'craft', 'auction', 'lootbox', 'rent'] as const) {
      expect(originLabel(o), o).not.toContain('arsenal.origin');
    }
  });
});

describe('арсенал — панель', () => {
  it('пустая коллекция — это состояние «пусто», а не пустая сетка', () => {
    const html = arsenalPanelHtml([], {});
    expect(html).toContain('hub-empty');
    expect(html).not.toContain('ar-grid');
  });

  it('чипы видов всегда есть; активен «все», пока фильтр не выбран', () => {
    const html = arsenalPanelHtml([hull], {});
    expect(html).toContain('<button class="ar-fchip on" data-ar-kind="">');
    expect(html).toContain('data-ar-kind="hull"');
    expect(html).toContain('data-ar-kind="hero_fitting"');
  });

  it('фильтр вида и подсвечивает свой чип, и режет сетку', () => {
    const html = arsenalPanelHtml([hull, gradedModule], { kind: 'module' });
    expect(html).toContain('<button class="ar-fchip on" data-ar-kind="module">');
    expect(html).toContain('md:laser');
    expect(html).not.toContain('u:cruiser');
  });

  it('чипы заточки появляются только при наличии заточенных предметов', () => {
    expect(arsenalPanelHtml([hull], {})).not.toContain('data-ar-grade');
    const withGrade = arsenalPanelHtml([hull, gradedModule], {});
    expect(withGrade).toContain('data-ar-grade="2"');
    expect(withGrade).toContain('ar-fsep');
  });
});

describe('арсенал — витрина (cache-first)', () => {
  it('кэш красится ДО сети, и без авторизации так и остаётся', async () => {
    const root = fakeRoot();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { refresh, items } = initArsenal(
      hostOf({ root: () => root, readCache: () => [hull] }),
    );
    await refresh();
    expect(root.html()).toContain('u:cruiser');
    expect(items()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled(); // authorizedBase() === null ⇒ в сеть не ходим
  });

  it('битый кэш вырождается в пустую витрину, а не в исключение', async () => {
    const root = fakeRoot();
    const { refresh, items } = initArsenal(
      hostOf({ root: () => root, readCache: () => ({ oops: true }) }),
    );
    await refresh();
    expect(items()).toEqual([]);
    expect(root.html()).toContain('hub-empty');
  });

  it('успешный ответ заменяет коллекцию и пишет кэш', async () => {
    const root = fakeRoot();
    const written: ArsenalItem[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { headers: Record<string, string> }) => {
        expect(url).toBe('https://srv/arsenal/me');
        expect(init.headers.authorization).toBe('Bearer tok');
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [fitting] }) });
      }),
    );
    const { refresh, items } = initArsenal(
      hostOf({
        root: () => root,
        readCache: () => [hull],
        writeCache: (i) => written.push([...i]),
        authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
      }),
    );
    await refresh();
    expect(items().map((i) => i.defId)).toEqual(['visor']);
    expect(written).toHaveLength(1);
    expect(root.html()).toContain('hf:visor');
  });

  it('отказ сервера и обрыв сети оставляют кэшированную коллекцию', async () => {
    for (const stub of [
      () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      () => Promise.reject(new Error('offline')),
    ]) {
      const root = fakeRoot();
      const written: unknown[] = [];
      vi.stubGlobal('fetch', vi.fn(stub));
      const { refresh, items } = initArsenal(
        hostOf({
          root: () => root,
          readCache: () => [hull],
          writeCache: (i) => written.push(i),
          authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
        }),
      );
      await refresh();
      expect(items().map((i) => i.defId)).toEqual(['cruiser']);
      expect(written).toEqual([]); // кэш не затирается неудачей
    }
  });

  it('чип вида и карточка обрабатываются делегированием на контейнере', async () => {
    const root = fakeRoot();
    const opened: string[] = [];
    const { refresh } = initArsenal(
      hostOf({
        root: () => root,
        readCache: () => [hull, gradedModule],
        openCodex: (k) => opened.push(k),
      }),
    );
    await refresh();
    // клик по чипу «модули» → перерисовка с фильтром
    root.fire({ closest: (sel: string) => (sel === '[data-ar-kind]' ? { dataset: { arKind: 'module' } } : null) });
    expect(root.html()).toContain('md:laser');
    expect(root.html()).not.toContain('u:cruiser');
    // клик по карточке → кодекс
    root.fire({
      closest: (sel: string) => (sel === '[data-codex]' ? { dataset: { codex: 'md:laser' } } : null),
    });
    expect(opened).toEqual(['md:laser']);
  });

  it('повторный клик по чипу заточки снимает фильтр', async () => {
    const root = fakeRoot();
    const { refresh } = initArsenal(
      hostOf({ root: () => root, readCache: () => [hull, gradedModule] }),
    );
    await refresh();
    const gradeClick = {
      closest: (sel: string) => (sel === '[data-ar-grade]' ? { dataset: { arGrade: '2' } } : null),
    };
    root.fire(gradeClick);
    expect(root.html()).not.toContain('u:cruiser'); // остался только заточенный
    root.fire(gradeClick);
    expect(root.html()).toContain('u:cruiser'); // фильтр снят
  });
});

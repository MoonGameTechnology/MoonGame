import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  CORP_TABS,
  CORP_AUDIT_RU,
  CORP_ROLE_DOT,
  corpRoleLabel,
  initCorp,
  type CorpHost,
} from './corpScreen';
import type { CorpRole } from './corp';

// REFM-11: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const ROLES: CorpRole[] = ['head', 'officer', 'member', 'recruit'];

/** The cabinet hides with `style.display`, not a class — the stand-in mirrors that. */
function fakeEl(): HTMLElement & { html: () => string; fire: (t: unknown) => void } {
  let handler: ((ev: unknown) => void) | null = null;
  const el = {
    innerHTML: '',
    style: { display: '' },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    html: () => el.innerHTML,
    fire: (target: unknown) => handler?.({ target }),
  };
  return el as unknown as HTMLElement & { html: () => string; fire: (t: unknown) => void };
}

function wire(over: Partial<CorpHost> = {}) {
  const root = fakeEl();
  const head = fakeEl();
  const tabs = fakeEl();
  const body = fakeEl();
  const notes: string[] = [];
  const intros: string[] = [];
  const api = initCorp({
    root: () => root,
    head: () => head,
    tabs: () => tabs,
    body: () => body,
    authorizedBase: () => Promise.resolve(null),
    note: (x) => notes.push(x),
    errText: (code) => `текст:${code}`,
    onIntro: (id) => intros.push(id),
    ...over,
  });
  return { api, root, head, tabs, body, notes, intros, shown: () => root.style.display };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('корпорации — словари', () => {
  it('у всех четырёх ролей есть подпись и свой цвет точки', () => {
    for (const r of ROLES) {
      expect(corpRoleLabel(r), r).not.toContain('corp.role');
      expect(corpRoleLabel(r), r).not.toBe('');
      expect(CORP_ROLE_DOT[r], r).toMatch(/^var\(--/);
    }
    // роли различимы — иначе список участников читался бы как однородный
    expect(new Set(ROLES.map(corpRoleLabel)).size).toBe(4);
  });

  it('у каждой вкладки есть локализованная подпись', () => {
    for (const tab of CORP_TABS) {
      expect(tab.label, tab.id).toMatch(/^corp\.tab\./);
      expect(t(tab.label), tab.id).not.toContain('corp.tab');
    }
    // порядок из corporation-ui.md §7: сначала живые вкладки, заглушки в конце
    expect(CORP_TABS.map((x) => x.id)).toEqual([
      'overview',
      'members',
      'wars',
      'treasury',
      'holdings',
      'comms',
    ]);
  });

  it('каждый вид записи аудита переводится — сырой ключ игроку не покажут', () => {
    for (const [kind, key] of Object.entries(CORP_AUDIT_RU)) {
      expect(key, kind).toMatch(/^corp\.audit\./);
      expect(t(key), kind).not.toContain('corp.audit');
    }
  });
});

describe('корпорации — кабинет', () => {
  it('open() красит, показывает и дёргает интро; close() прячет', () => {
    const { api, body, intros, shown } = wire();
    expect(shown()).toBe('');
    api.open();
    expect(shown()).toBe('flex');
    expect(body.html()).not.toBe('');
    expect(intros).toEqual(['corp']);
    api.close();
    expect(shown()).toBe('none');
  });

  it('без корпорации `mine()` пуст — профиль по нему рисует прочерк', () => {
    const { api } = wire();
    api.open();
    expect(api.mine()).toEqual({ corp: null, membership: null });
  });

  it('без авторизации кабинет в сеть не ходит вовсе', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { api } = wire();
    api.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('вкладка «Войны» дополнительно показывает своё интро', () => {
    const { api, tabs, intros } = wire();
    api.open();
    tabs.fire({ closest: (s: string) => (s === '[data-corptab]' ? { dataset: { corptab: 'wars' } } : null) });
    expect(intros).toEqual(['corp', 'ava']);
  });

  it('переключение вкладки перерисовывает тело', () => {
    const { api, tabs, body } = wire();
    api.open();
    const before = body.html();
    tabs.fire({
      closest: (s: string) =>
        s === '[data-corptab]' ? { dataset: { corptab: 'holdings' } } : null,
    });
    expect(body.html()).not.toBe(before);
  });

  it('крестик и фон закрывают кабинет', () => {
    const { api, root, shown } = wire();
    api.open();
    root.fire({ id: 'corpclose', closest: () => null });
    expect(shown()).toBe('none');
    api.open();
    root.fire({ id: 'corp', closest: () => null });
    expect(shown()).toBe('none');
  });

  it('серверный код ошибки становится тостом через errText, а не сырым E_*', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'E_NO_CORP' }) })),
    );
    const { api, notes } = wire({
      authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
    });
    api.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.some((n) => n.includes('текст:E_NO_CORP'))).toBe(true);
    expect(notes.every((n) => !/^✖ E_/.test(n))).toBe(true);
  });

  it('обрыв сети не роняет кабинет и не сыплет тостами', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { api, notes, shown } = wire({
      authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
    });
    expect(() => api.open()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('flex');
    expect(notes).toEqual([]); // молчаливая деградация: сеть упала — не вина игрока
  });
});

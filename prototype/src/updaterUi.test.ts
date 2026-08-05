import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { BuildInfo, UpdateCheck, UpdateInfo } from './updater';
import {
  diagMsg,
  isCheckFailure,
  initUpdaterUi,
  CHECK_GAP_MS,
  DIAG_HOLD_MS,
  type UpdaterUiHost,
} from './updaterUi';

// REFM-23: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const BUILD: BuildInfo = { versionCode: 100, sha: 'abc1234' };
const NEWER: UpdateInfo = {
  versionCode: 101,
  sha: 'def5678',
  apkUrl: 'https://github.com/x/y/releases/download/alpha/void-dominion-alpha.apk',
  notes: 'void:versionCode=101',
};

/** Элемент без DOM: то, чем витрина реально пользуется, — текст, стиль и клик. */
function fakeEl() {
  const on: Record<string, Array<(ev: { preventDefault(): void }) => void>> = {};
  return {
    textContent: '' as string | null,
    style: { display: 'none' } as { display: string; color?: string },
    href: '',
    addEventListener(type: string, h: (ev: { preventDefault(): void }) => void) {
      (on[type] ??= []).push(h);
    },
    click(): boolean {
      let prevented = false;
      for (const h of on.click ?? []) h({ preventDefault: () => (prevented = true) });
      return prevented;
    },
  };
}

type FakeEl = ReturnType<typeof fakeEl>;

const IDS = ['cver', 'cupd', 'updbar', 'ub-ver', 'ub-go', 'ub-later', 'hub-upd', 'hub-note'];

function wired(over: Partial<UpdaterUiHost> = {}, present: readonly string[] = IDS) {
  const els = new Map<string, FakeEl>();
  for (const id of present) els.set(id, fakeEl());
  let result: UpdateCheck = { kind: 'current', local: 100, remote: 100 };
  let checks = 0;
  let clock = 1_000_000;
  let online = true;
  let bridge = true;
  const opened: string[] = [];
  const timers: Array<[number, () => void]> = [];
  const api = initUpdaterUi({
    build: () => BUILD,
    check: () => {
      checks++;
      return Promise.resolve(result);
    },
    el: (id) => (els.get(id) ?? null) as unknown as HTMLElement | null,
    now: () => clock,
    online: () => online,
    openExternal: (u) => {
      if (!bridge) return false;
      opened.push(u);
      return true;
    },
    after: (ms, fn) => timers.push([ms, fn]),
    ...over,
  });
  return {
    api,
    el: (id: string) => els.get(id)!,
    checks: () => checks,
    opened,
    timers,
    /** Прокрутить отложенные возвраты подписи. */
    flush: () => {
      for (const [, fn] of timers.splice(0)) fn();
    },
    setResult: (r: UpdateCheck) => {
      result = r;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    setOnline: (v: boolean) => {
      online = v;
    },
    setBridge: (v: boolean) => {
      bridge = v;
    },
  };
}

describe('обновление — диагностика проверки', () => {
  const cases: UpdateCheck[] = [
    { kind: 'update', info: NEWER, local: 100 },
    { kind: 'current', local: 100, remote: 100 },
    { kind: 'offline', error: 'dns' },
    { kind: 'http', status: 403 },
    { kind: 'unparsable' },
    { kind: 'dormant' },
  ];

  it('у каждого исхода своя строка — их можно различить', () => {
    const said = cases.map(diagMsg);
    expect(said.every((s) => s.length > 0)).toBe(true);
    expect(new Set(said).size).toBe(cases.length);
  });

  it('«актуально» называет обе сборки — иначе проверку не проследить', () => {
    expect(diagMsg({ kind: 'current', local: 100, remote: 101 })).toContain('100');
    expect(diagMsg({ kind: 'current', local: 100, remote: 101 })).toContain('101');
  });

  it('код ответа GitHub попадает в строку', () => {
    expect(diagMsg({ kind: 'http', status: 403 })).toContain('403');
  });

  it('неудача проверки отличается от ответа по существу', () => {
    expect(isCheckFailure({ kind: 'offline', error: 'dns' })).toBe(true);
    expect(isCheckFailure({ kind: 'http', status: 500 })).toBe(true);
    expect(isCheckFailure({ kind: 'current', local: 1, remote: 1 })).toBe(false);
    expect(isCheckFailure({ kind: 'update', info: NEWER, local: 1 })).toBe(false);
    expect(isCheckFailure({ kind: 'dormant' })).toBe(false);
  });
});

describe('обновление — дев-сборка спит', () => {
  it('без собственной сборки ничего не показано и никуда не ходим', () => {
    const w = wired({ build: () => null });
    w.api.maybeCheck();
    w.api.manualCheck(w.el('cver') as unknown as HTMLElement);
    expect(w.checks()).toBe(0);
    expect(w.el('cupd').style.display).toBe('none'); // кнопка проверки не всплыла
    expect(w.el('cver').textContent).toBe('');
    expect(w.el('hub-upd').style.display).toBe('none');
  });
});

describe('обновление — витрина в АПК', () => {
  it('своя сборка подписана, кнопки проверки показаны', () => {
    const w = wired();
    expect(w.el('cver').textContent).toContain('abc1234');
    expect(w.el('cupd').style.display).toBe('');
    expect(w.el('hub-upd').style.display).toBe('');
  });

  it('нет разметки — сборка не падает', () => {
    expect(() => wired({}, []).api.maybeCheck()).not.toThrow();
  });

  it('баннер появляется только когда сборка НОВЕЕ', async () => {
    const w = wired();
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.el('updbar').style.display).toBe('none');

    const w2 = wired();
    w2.setResult({ kind: 'update', info: NEWER, local: 100 });
    w2.api.maybeCheck();
    await Promise.resolve();
    expect(w2.el('updbar').style.display).toBe('block');
    expect(w2.el('ub-ver').textContent).toContain('def5678');
    expect(w2.el('ub-go').href).toBe(NEWER.apkUrl);
  });

  it('«позже» убирает баннер', async () => {
    const w = wired();
    w.setResult({ kind: 'update', info: NEWER, local: 100 });
    w.api.maybeCheck();
    await Promise.resolve();
    w.el('ub-later').click();
    expect(w.el('updbar').style.display).toBe('none');
  });
});

describe('обновление — «Обновить»', () => {
  it('нативный мост забирает ссылку, переход по <a> отменяется', async () => {
    const w = wired();
    w.setResult({ kind: 'update', info: NEWER, local: 100 });
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.el('ub-go').click()).toBe(true);
    expect(w.opened).toEqual([NEWER.apkUrl]);
  });

  it('моста нет (браузер) — переходу не мешаем', async () => {
    const w = wired();
    w.setBridge(false);
    w.setResult({ kind: 'update', info: NEWER, local: 100 });
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.el('ub-go').click()).toBe(false);
    expect(w.opened).toEqual([]);
  });

  it('ссылки ещё нет — открывать нечего', () => {
    const w = wired();
    expect(w.el('ub-go').click()).toBe(false);
    expect(w.opened).toEqual([]);
  });
});

describe('обновление — ручная проверка', () => {
  it('кнопка окна подключения пишет диагностику рядом с версией', async () => {
    const w = wired();
    const was = w.el('cver').textContent;
    w.el('cupd').click();
    await Promise.resolve();
    expect(w.checks()).toBe(1);
    expect(w.el('cver').textContent).not.toBe(was);
    expect(w.el('cver').textContent).toContain('100');
  });

  it('диагностика держится ограниченное время и подпись возвращается', async () => {
    const w = wired();
    const was = w.el('cver').textContent;
    w.el('cupd').click();
    await Promise.resolve();
    expect(w.timers[0]?.[0]).toBe(DIAG_HOLD_MS);
    w.flush();
    expect(w.el('cver').textContent).toBe(was);
    expect(w.el('cver').style.color).toBe('');
  });

  it('неудача подсвечена тревожным, успех — нет', async () => {
    const bad = wired();
    bad.setResult({ kind: 'offline', error: 'dns' });
    bad.el('cupd').click();
    await Promise.resolve();
    expect(bad.el('cver').style.color).toBe('var(--amber)');

    const ok = wired();
    ok.el('cupd').click();
    await Promise.resolve();
    expect(ok.el('cver').style.color).toBe('');
  });

  it('кнопка хаба отвечает в строку заметок, а не в окно подключения', async () => {
    const w = wired();
    const wasCver = w.el('cver').textContent;
    w.el('hub-upd').click();
    await Promise.resolve();
    expect(w.el('hub-note').textContent).toBeTruthy();
    expect(w.el('cver').textContent).toBe(wasCver);
  });

  it('ручная проверка идёт МИМО дросселя — игрок нажал, значит надо сходить', async () => {
    const w = wired();
    w.api.maybeCheck();
    await Promise.resolve();
    w.el('cupd').click();
    await Promise.resolve();
    expect(w.checks()).toBe(2);
  });
});

describe('обновление — дроссель тихих проверок', () => {
  it('старт проверяет сразу, повтор в ту же минуту — нет', async () => {
    const w = wired();
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.checks()).toBe(1);
    w.advance(60_000);
    w.api.maybeCheck();
    expect(w.checks()).toBe(1);
  });

  it('после паузы проверка снова разрешена', async () => {
    const w = wired();
    w.api.maybeCheck();
    await Promise.resolve();
    w.advance(CHECK_GAP_MS + 1);
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.checks()).toBe(2);
  });

  it('нет сети — в GitHub не стучимся и дроссель не тратим', async () => {
    const w = wired();
    w.setOnline(false);
    w.api.maybeCheck();
    expect(w.checks()).toBe(0);
    w.setOnline(true);
    w.api.maybeCheck();
    await Promise.resolve();
    expect(w.checks()).toBe(1);
  });

  it('проверка уже идёт — вторая не стартует', () => {
    let release: ((r: UpdateCheck) => void) | null = null;
    let checks = 0;
    const w = wired({
      check: () => {
        checks++;
        return new Promise<UpdateCheck>((res) => (release = res));
      },
    });
    w.api.maybeCheck();
    w.advance(CHECK_GAP_MS + 1);
    w.api.maybeCheck();
    expect(checks).toBe(1);
    release!({ kind: 'current', local: 100, remote: 100 });
  });
});

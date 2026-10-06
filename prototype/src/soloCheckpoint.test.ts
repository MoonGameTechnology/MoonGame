/**
 * Сохранение схватки (REFM-213) — прямой тест владельца слота.
 *
 * Флаг слота меняют только двери модуля, поэтому здесь проверено то, что текстом не
 * проверить: когда слот открыт и закрыт, что и когда он пишет, как молчит о повторной беде,
 * как «Продолжить» поднимает партию после перезагрузки и не затирает читаемый снимок, что
 * показывает дверь хаба и когда спрашивают о замене. Каждый тест — свежая загрузка модулей
 * над своим хранилищем и своей «страницей» из заглушек элементов.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SoloSave } from '../../decisions/soloSave';
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { SOLO_SAVE_KEY } from './soloSaveLocal';

interface Stub {
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  style: { display: string };
  focused: number;
  focus(): void;
  addEventListener(type: string, fn: () => void): void;
  click(): void;
}

let cell: Map<string, string>;
let failWrites: boolean;
let page: Map<string, Stub>;

function stub(): Stub {
  let onClick: (() => void) | null = null;
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    style: { display: '' },
    focused: 0,
    focus() {
      this.focused++;
    },
    addEventListener(type, fn) {
      if (type === 'click') onClick = fn;
    },
    click() {
      onClick?.();
    },
  };
}
const el = (id: string): Stub => {
  if (!page.has(id)) page.set(id, stub());
  return page.get(id)!;
};

beforeEach(() => {
  cell = new Map();
  failWrites = false;
  page = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('quota');
      cell.set(k, v);
    },
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('document', { getElementById: el });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Свежая загрузка слота и игры над текущим хранилищем — как после перезагрузки страницы. */
async function boot() {
  vi.resetModules();
  const solo = await import('./soloCheckpoint');
  const game = await import('./game');
  const env = {
    s: game.advance(game.newGame(), 1000).state as GameState,
    net: false,
    practice: false,
    inMatch: true,
    newcomer: false,
    halts: 0,
    shown: 0,
    started: 0,
    installed: [] as SoloSave[],
    notes: [] as string[],
  };
  solo.initSoloCheckpoint({
    world: () => env.s,
    net: () => env.net,
    practice: () => env.practice,
    inMatch: () => env.inMatch,
    snapshot: () => ({
      state: env.s,
      ai: [['p2', 'strong']],
      normalSpeed: 50,
      fastSpeed: 150,
      autoAssault: ['f1'],
      memory: [],
    }),
    halt: () => void env.halts++,
    // Как `installMatch`: сначала уходит со схватки — последней записью слота, — потом
    // ставит мир.
    install: (save) => {
      solo.leaveSolo();
      env.installed.push(save);
      env.s = save.state;
    },
    show: () => void env.shown++,
    startNew: () => void env.started++,
    newcomer: () => env.newcomer,
    mapLabel: (mapId) => `карта ${mapId}`,
    note: (text) => void env.notes.push(text),
  });
  return { solo, game, env };
}

/** Мир в слоте — то, что поднимет «Продолжить». */
const stored = (): GameState | null => {
  const raw = cell.get(SOLO_SAVE_KEY);
  return raw ? (JSON.parse(raw) as { payload: SoloSave }).payload.state : null;
};

describe('REFM-213 — двери слота', () => {
  it('слот закрыт, пока схватку не начали: ни записи, ни строки в ленте', async () => {
    const { solo, env } = await boot();
    expect(solo.soloSaveActive).toBe(false);
    solo.saveSolo(true);
    solo.tickSoloSave(1e9);
    solo.suspendSolo();
    expect(cell.has(SOLO_SAVE_KEY)).toBe(false);
    expect(env.notes).toEqual([]);
    expect(env.halts).toBe(0);
  });

  it('старт схватки открывает слот и сразу пишет мир', async () => {
    const { solo, env } = await boot();
    solo.enterSolo(true);
    expect(solo.soloSaveActive).toBe(true);
    expect(stored()?.time).toBe(env.s.time);
    expect(env.notes).toEqual([]);
  });

  it('не сохраняемая, сетевая и песочная партии слот не открывают', async () => {
    const { solo, env } = await boot();
    solo.enterSolo(false);
    expect(solo.soloSaveActive).toBe(false);
    env.net = true;
    solo.enterSolo(true);
    expect(solo.soloSaveActive).toBe(false);
    env.net = false;
    env.practice = true;
    solo.enterSolo(true);
    expect(solo.soloSaveActive).toBe(false);
    expect(cell.has(SOLO_SAVE_KEY)).toBe(false);
  });

  it('уход со схватки — последняя запись, и слот закрыт', async () => {
    const { solo, game, env } = await boot();
    solo.enterSolo(true);
    env.s = game.advance(env.s, env.s.time + 500).state;
    solo.leaveSolo();
    expect(solo.soloSaveActive).toBe(false);
    expect(stored()?.time).toBe(env.s.time);
    // Дальше слот молчит, что бы ни случилось с миром на экране.
    const kept = env.s.time;
    env.s = game.advance(env.s, env.s.time + 500).state;
    solo.saveSolo(true);
    expect(stored()?.time).toBe(kept);
  });

  it('конец партии стирает слот и закрывает его', async () => {
    const { solo, env } = await boot();
    solo.enterSolo(true);
    env.s = { ...env.s, match: { ...env.s.match, status: 'ended', winner: 'p1' } };
    solo.tickSoloSave(0);
    expect(cell.has(SOLO_SAVE_KEY)).toBe(false);
    expect(solo.soloSaveActive).toBe(false);
  });
});

describe('REFM-213 — запись слота', () => {
  it('такт записи — не чаще раза в 15 с и только в партии на экране', async () => {
    const { solo, game, env } = await boot();
    solo.enterSolo(true);
    const first = env.s.time;
    env.s = game.advance(env.s, first + 500).state;
    solo.tickSoloSave(20_000);
    const second = env.s.time;
    expect(stored()?.time).toBe(second);
    env.s = game.advance(env.s, second + 500).state;
    solo.tickSoloSave(34_999);
    expect(stored()?.time).toBe(second);
    env.inMatch = false;
    solo.tickSoloSave(40_000);
    expect(stored()?.time).toBe(second);
    env.inMatch = true;
    solo.tickSoloSave(40_000);
    expect(stored()?.time).toBe(env.s.time);
  });

  it('явная запись говорит «сохранено», беда — один раз, пока игрок сам не спросит', async () => {
    const { solo, env } = await boot();
    solo.enterSolo(true);
    solo.saveSolo(true);
    expect(env.notes).toEqual([t('solo.save.saved')]);
    failWrites = true;
    solo.saveSolo();
    solo.saveSolo();
    expect(env.notes).toEqual([t('solo.save.saved'), t('solo.save.failed')]);
    solo.saveSolo(true);
    expect(env.notes.at(-1)).toBe(t('solo.save.failed'));
    expect(env.notes).toHaveLength(3);
    // Беда видна и на двери хаба, пока запись не удастся.
    solo.refreshHubDoor();
    expect(el('solo-save-status').textContent).toBe(t('solo.save.failed'));
    failWrites = false;
    solo.saveSolo();
    solo.refreshHubDoor();
    expect(el('solo-save-status').textContent).toBe('');
  });

  it('уход со страницы пишет слот и ставит мир на паузу; в сети — ничего', async () => {
    const { solo, game, env } = await boot();
    solo.enterSolo(true);
    env.s = game.advance(env.s, env.s.time + 500).state;
    solo.suspendSolo();
    expect(stored()?.time).toBe(env.s.time);
    expect(env.halts).toBe(1);
    env.net = true;
    solo.suspendSolo();
    expect(env.halts).toBe(1);
  });
});

describe('REFM-213 — «Продолжить» и дверь хаба', () => {
  it('после перезагрузки «Продолжить» ставит сохранённую партию и снова открывает слот', async () => {
    const first = await boot();
    first.solo.enterSolo(true);
    const saved = first.env.s;

    const { solo, env } = await boot();
    expect(solo.soloSaveActive).toBe(false);
    env.s = first.game.newGame();
    solo.restoreSolo();
    expect(env.installed).toHaveLength(1);
    expect(env.installed[0]!.state).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(env.installed[0]!.ai).toEqual([['p2', 'strong']]);
    expect(solo.soloSaveActive).toBe(true);
    expect(env.shown).toBe(1);
    expect(env.notes).toEqual([t('solo.save.restored')]);
  });

  it('установка партии из слота не затирает читаемый снимок', async () => {
    const { solo, game, env } = await boot();
    solo.enterSolo(true);
    const savedTime = env.s.time;
    // Мир на экране ушёл вперёд после записи, а слот открыт: из хаба жмут «Продолжить».
    env.s = game.advance(env.s, savedTime + 9000).state;
    solo.restoreSolo();
    expect(env.installed[0]!.state.time).toBe(savedTime);
    expect(stored()?.time).toBe(savedTime);
  });

  it('в сети, с пустым слотом и с картой, которой нет, «Продолжить» ничего не ставит', async () => {
    const { solo, env } = await boot();
    solo.enterSolo(true);
    solo.leaveSolo();
    const good = cell.get(SOLO_SAVE_KEY)!;
    // Сетевая партия на экране: её мир хранит сервер, слот не поднимается.
    env.net = true;
    solo.restoreSolo();
    expect(env.installed).toEqual([]);
    env.net = false;
    cell.delete(SOLO_SAVE_KEY);
    solo.restoreSolo();
    expect(env.installed).toEqual([]);
    // Снимок цел, но карты нет: игрок видит, что сохранение не читается.
    const { serializeSoloSave } = await import('../../decisions/soloSave');
    const { hashJson } = await import('../../packages/shared-core/src/index');
    const { data } = await import('./game');
    const { kernel } = await import('./protoKernel');
    const payload = (JSON.parse(good) as { payload: SoloSave }).payload;
    const bad = { ...payload, state: { ...payload.state, mapId: 'нет-такой' } };
    cell.set(SOLO_SAVE_KEY, serializeSoloSave(bad, hashJson({ data, modules: kernel.manifest })));
    solo.restoreSolo();
    expect(env.installed).toEqual([]);
    expect(el('solo-save-status').textContent).toBe(t('solo.save.invalid'));
    cell.set(SOLO_SAVE_KEY, good);
    solo.restoreSolo();
    expect(env.installed).toHaveLength(1);
  });

  it('дверь хаба: «Продолжить» с картой и днём, новичку обучение, битый слот — не нажать', async () => {
    const { solo, env } = await boot();
    env.newcomer = true;
    solo.refreshHubDoor();
    expect(el('hub-solo-continue').hidden).toBe(true);
    expect(el('onboard-nudge').style.display).toBe('flex');

    solo.enterSolo(true);
    solo.refreshHubDoor();
    expect(el('hub-solo-continue').hidden).toBe(false);
    expect(el('hub-solo-continue').disabled).toBe(false);
    expect(el('onboard-nudge').style.display).toBe('none');
    expect(el('hub-continue-sub').textContent).toContain('карта nexus');

    cell.set(SOLO_SAVE_KEY, '{"v":1}');
    solo.refreshHubDoor();
    expect(el('hub-solo-continue').hidden).toBe(false);
    expect(el('hub-solo-continue').disabled).toBe(true);
    expect(el('hub-continue-sub').textContent).toBe('');
    expect(el('solo-save-status').textContent).toBe(t('solo.save.invalid'));
  });

  it('замена сохранения: пустой слот не спрашивает, занятый — спрашивает, «заменить» стартует', async () => {
    const { solo, env } = await boot();
    expect(solo.askReplace()).toBe(false);
    expect(el('solo-replace').style.display).toBe('');

    solo.enterSolo(true);
    expect(solo.askReplace()).toBe(true);
    expect(el('solo-replace').style.display).toBe('flex');
    expect(el('solo-replace-cancel').focused).toBe(1);

    el('solo-replace-cancel').click();
    expect(el('solo-replace').style.display).toBe('none');
    expect(el('setupgo').focused).toBe(1);
    expect(env.started).toBe(0);

    solo.askReplace();
    el('solo-replace-confirm').click();
    expect(el('solo-replace').style.display).toBe('none');
    expect(env.started).toBe(1);
  });
});

/**
 * Конвейер приказа (REFM-240) — прямой тест владельца: путь приказа игрока от нажатия до
 * мира и обратно в ленту.
 *
 * Здесь проверено то, что текстом не проверить: шаг заменяет мир, чистит выбор и отдаёт
 * события разбору; принятый приказ в соло меняет мир и учит тур, отвергнутый слышен и
 * виден в ленте; песочница с бесплатной стройкой возвращает казну; рассказы о вахте, герое
 * и стройке пишут ленту ключами языка игрока, а доклад вахты по истечении сравнивает
 * положение со снимком при передаче. Сетевой путь (намерение в сокет, очередь при обрыве)
 * держат `decisions/netClientReuse.test.ts` (правило маршрута) и `smoke:net` (живой провод).
 * Каждый тест — свежая загрузка модулей: у выбора, песочницы и конвейера своё состояние.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { DomainEvent, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { refusalText } from '../../decisions/refusalText';
import { buildBuilding, moveFleet } from '../../decisions/actions';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./orderPipeline');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__PLAYER_BUILD__', false); // песочница читает профиль сборки
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot() {
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = {
    world,
    events: [] as DomainEvent[][],
    notes: [] as Array<[string, string | undefined]>,
    refusals: 0,
    intros: [] as string[],
    taught: [] as string[],
    tour: null as { active: boolean; notifyAction(type: string): void } | null,
    stewardOpen: false,
    repaints: 0,
  };
  const pipe = await import('./orderPipeline');
  pipe.initOrderPipeline({
    world: () => env.world,
    setWorld: (state) => {
      env.world = state;
    },
    me: () => 'p1',
    handleEvents: (events) => env.events.push(events),
    note: (text, at) => env.notes.push([text, at]),
    placeName: (id) => `«${id}»`,
    refusalSound: () => env.refusals++,
    tour: () => env.tour,
    intro: (id) => env.intros.push(id),
    steward: () => ({ isOpen: () => env.stewardOpen, repaint: () => env.repaints++ }),
  });
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  return { pipe, env, home, fleet, game };
}

describe('REFM-240 — шаг мира', () => {
  it('шаг заменяет мир, чистит выбор и отдаёт события разбору', async () => {
    const { pipe, env, game } = await boot();
    const sel = await import('./interaction');
    sel.pickFleets(['gone'], () => true);
    expect(sel.selFleet).toBe('gone');
    const out = game.advance(env.world, env.world.time + 1);
    pipe.apply(out);
    expect(env.world).toBe(out.state);
    expect(sel.selFleet).toBeNull(); // флота нет в новом мире — выбор забыт
    expect(env.events).toEqual([out.events]);
    // Эскадра в воздухе (SHU-6.14): выбор держится, пока вылет есть в новом мире.
    sel.pickStrike('st1');
    const aloft = { ...env.world, strikes: [{ id: 'st1' }] } as unknown as GameState;
    pipe.apply({ state: aloft, events: [] } as never);
    expect(sel.selStrike).toBe('st1');
    pipe.apply({ state: { ...aloft, strikes: [] }, events: [] } as never);
    expect(sel.selStrike).toBeNull();
  });
});

describe('REFM-240 — приказ игрока в соло', () => {
  it('принятый приказ меняет мир и учит тур; вставка «задержки» — только в сети', async () => {
    const { pipe, env, fleet, home } = await boot();
    const before = env.world;
    env.tour = { active: true, notifyAction: (type) => env.taught.push(type) };
    const to = home.links![0]!;
    expect(pipe.playerOrder(moveFleet('p1', fleet.id, to))).toBe(true);
    expect(env.world).not.toBe(before);
    expect(env.world.fleets[fleet.id]?.movement?.to ?? env.world.fleets[fleet.id]?.location).toBe(
      to,
    );
    expect(env.taught).toEqual(['fleet.move']);
    expect(env.refusals).toBe(0);
    expect(env.intros).toEqual([]);
  });

  it('принятый приказ поднимает вставку обучения; тур читается уже после урока', async () => {
    // Какая вставка у какого приказа — `introTrigger.ts` со своим тестом; здесь — проводка:
    // тур, кончившийся на этом приказе, вставку не глушит.
    const asked: Array<[string, boolean, boolean]> = [];
    vi.doMock('./introTrigger', () => ({
      introFor: (type: string, tourActive: boolean, net: boolean) => {
        asked.push([type, tourActive, net]);
        return tourActive ? null : 'retreat';
      },
    }));
    try {
      const { pipe, env, fleet, home } = await boot();
      env.tour = {
        active: true,
        notifyAction: (type) => {
          env.taught.push(type);
          env.tour = null; // последний шаг тура
        },
      };
      expect(pipe.playerOrder(moveFleet('p1', fleet.id, home.links![0]!))).toBe(true);
      expect(env.taught).toEqual(['fleet.move']);
      expect(asked).toEqual([['fleet.move', false, false]]);
      expect(env.intros).toEqual(['retreat']);
    } finally {
      vi.doUnmock('./introTrigger');
    }
  });

  it('отказ слышен и виден: звук, строка ленты с именем отказа, исход false', async () => {
    const { pipe, env, fleet, game } = await boot();
    const action = moveFleet('p1', fleet.id, 'nowhere');
    const code = game.order(env.world, action, env.world.time).error;
    expect(code).toBeTruthy(); // ядро отвечает одинаково на тот же мир
    expect(pipe.playerOrder(action)).toBe(false);
    expect(env.refusals).toBe(1);
    expect(env.notes).toEqual([['✖ ' + refusalText(code!), undefined]]);
    expect(env.intros).toEqual([]);
  });

  it('песочница с бесплатной стройкой возвращает казну, без неё стройка платная', async () => {
    const paid = await boot();
    const wallet = (env: { world: GameState }) => ({ ...env.world.players.p1!.resources });
    const before = wallet(paid.env);
    expect(paid.pipe.playerOrder(buildBuilding('p1', paid.home.id, 'farm'))).toBe(true);
    expect(wallet(paid.env)).not.toEqual(before); // обычная партия платит

    const free = await boot();
    const sandbox = await import('./sandbox');
    sandbox.sandboxConfig.enabled = true;
    sandbox.sandboxConfig.freeBuild = true;
    const start = wallet(free.env);
    expect(free.pipe.playerOrder(buildBuilding('p1', free.home.id, 'farm'))).toBe(true);
    expect(free.env.world.players.p1!.resources).toEqual(start);
    // Отказ при бесплатной стройке ничего не возвращает: платить было нечем.
    expect(free.pipe.playerOrder(buildBuilding('p1', free.home.id, 'no-such-building'))).toBe(
      false,
    );
    expect(wallet(free.env)).toEqual(start);
  });
});

describe('REFM-240 — рассказы ленты', () => {
  it('вахта: передача — строка ключом, окно вахты перерисовано, если открыто', async () => {
    const { pipe, env } = await boot();
    env.stewardOpen = true;
    pipe.tellSteward('delegated', { posture: 'defensive' });
    expect(env.notes).toHaveLength(1);
    expect(env.repaints).toBe(1);
    env.stewardOpen = false;
    pipe.tellSteward('recalled', {});
    expect(env.notes).toHaveLength(2);
    expect(env.repaints).toBe(1);
  });

  it('вахта: доклад по истечении сравнивает со снимком при передаче', async () => {
    const { pipe, env } = await boot();
    const { stewMetrics } = await import('./stewardScreen');
    const { diffFields, stewardReport } = await import('./stewardLog');
    const { TECH_CUR } = await import('./format');
    pipe.tellSteward('delegated', {});
    const base = stewMetrics(env.world, 'p1');
    const me = env.world.players.p1!;
    const credits = (me.resources.credits ?? 0) + 500;
    env.world = {
      ...env.world,
      players: { ...env.world.players, p1: { ...me, resources: { ...me.resources, credits } } },
    };
    pipe.tellSteward('expired', {});
    const d = diffFields(base, stewMetrics(env.world, 'p1'), TECH_CUR);
    expect(d).toBeTruthy();
    expect(env.notes[1]![0]).toBe(
      t(stewardReport('expired', undefined).key) + ' ' + t('log.steward.diff', d!),
    );
    // Снимок забыт с докладом: следующая передача снимет новый.
    pipe.tellSteward('expired', {});
    expect(env.notes[2]![0]).toBe(t(stewardReport('expired', undefined).key));
  });

  it('герой: гибель со сроком, без новости — тишина', async () => {
    const { pipe, env } = await boot();
    pipe.tellHero(null);
    expect(env.notes).toEqual([]);
    pipe.tellHero({ key: 'log.hero.died', heroId: 'h-x', leftMs: 2 * 3_600_000, at: 'A' } as never);
    expect(env.notes).toHaveLength(1);
    expect(env.notes[0]![1]).toBe('A');
  });

  it('стройка: строка ключом с именем места; к миру привязаны только потери', async () => {
    const { pipe, env, home } = await boot();
    pipe.tellBuild('constructed', { building: 'radar', planetId: home.id });
    pipe.tellBuild('upgraded', { building: 'radar', planetId: home.id, level: 2 });
    pipe.tellBuild('destroyed', { building: 'radar', planetId: home.id });
    expect(env.notes.map(([text]) => text.includes(`«${home.id}»`))).toEqual([true, true, true]);
    expect(env.notes.map(([, at]) => at)).toEqual([undefined, undefined, home.id]);
    expect(env.notes[1]![0]).toContain('2');
  });
});

describe('REFM-240 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const PIPE = readFileSync(new URL('./orderPipeline.ts', import.meta.url), 'utf8');
  const init = /initOrderPipeline\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки конвейера — мир и его замена, место, разбор, лента, звук, тур, вставки, вахта', () => {
    for (const hook of [
      'world: () => s,',
      's = state;',
      'me: () => ME,',
      'handleEvents,',
      'note,',
      'placeName,',
      "refusalSound: () => snd.play('error'),",
      'tour: () => activeTour,',
      'intro: maybeIntro,',
      'steward: () => steward,',
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('конвейер живёт у владельца, `main.ts` только зовёт его', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (apply|playerOrder|sandboxBuildSnapshot|sandboxBuildRestore|tellSteward|tellHero|tellBuild)\(/,
    );
    expect(MAIN).not.toMatch(/\bstewSnapshot\b/);
    expect(PIPE).not.toMatch(/from '\.\/main'/);
  });
});

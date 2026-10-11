/**
 * Приказы группе (REFM-228) — прямой тест владельца: курс, штурм, запрос войны, слияние,
 * стойка авто-штурма и вход меню десанта на живом мире прототипа.
 *
 * Правила, из которых приказ собран, держат свои тесты (`warPrompt.ts`, `warOrders.ts`,
 * `assaultDispatch.ts`, `mergeOrders.ts`, `stanceToggle.ts`, `troopsScene.ts`). Здесь —
 * то, что текстом не проверить: приказ доходит до ядра и меняет мир, путь через мирных
 * останавливается окном войны, подтверждение объявляет войну раньше хода, отмена ничего
 * не издаёт, стойка авто-штурма в соло живёт у владельца и переживает сохранение, а в
 * сети уходит приказом. Каждый тест — свежая загрузка модулей: у выбора, конвейера и
 * приказов группе своё состояние.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Action, Fleet, GameState } from '../../packages/shared-core/src/index';
import { getStance, journeyDestination } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./groupOrders');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__PLAYER_BUILD__', false); // конвейер читает профиль сборки
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Окно войны на странице: разметка и показан ли он. */
function fakePrompt() {
  const classes = new Set<string>();
  const el = {
    innerHTML: '',
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
  };
  vi.stubGlobal('document', { getElementById: (id: string) => (id === 'warprompt' ? el : null) });
  return { el, shown: () => classes.has('show') };
}

async function boot() {
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      {
        id: 'p1',
        name: 'Azure Compact',
        faction: 'azure',
        start: game.START_CANDIDATES[0]!,
        ai: false,
      },
      { id: 'p2', name: '<B&>', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = {
    world,
    notes: [] as Array<[string, string | undefined]>,
    selected: [] as string[][],
  };
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => [],
  });
  const note = (text: string, at?: string) => env.notes.push([text, at]);
  const pipe = await import('./orderPipeline');
  pipe.initOrderPipeline({
    world: () => env.world,
    setWorld: (state) => {
      env.world = state;
    },
    me: () => 'p1',
    handleEvents: () => {},
    note,
    placeName: (id) => id,
    refusalSound: () => {},
    tour: () => null,
    intro: () => {},
    steward: () => null,
  });
  const go = await import('./groupOrders');
  go.initGroupOrders({
    world: () => env.world,
    me: () => 'p1',
    note,
    seatName: (id) => (id === 'p2' ? 'Багровые' : undefined),
    selectFleets: (ids) => env.selected.push(ids),
  });
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const foe = Object.values(world.planets).find((p) => p.owner === 'p2')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  return { go, env, home, foe, fleet };
}

/** Второй свой флот рядом с первым — без героя, его ядро сливает. */
function addFleet(env: { world: GameState }, from: Fleet, id: string, at = from.location): void {
  const twin: Fleet = { ...from, id, location: at, units: [{ unit: 'cruiser', count: 1 }] };
  env.world = { ...env.world, fleets: { ...env.world.fleets, [id]: twin } };
}

describe('REFM-228 — курс группой', () => {
  it('свободный путь: приказ каждому живому флоту, окна войны нет', async () => {
    const { go, env, home, fleet } = await boot();
    const prompt = fakePrompt();
    const to = home.links![0]!;
    go.tryMoveGroup([fleet.id, 'gone'], to);
    expect(env.world.fleets[fleet.id]?.movement?.to).toBe(to);
    expect(go.warPrompt).toBeNull();
    expect(prompt.shown()).toBe(false);
  });

  it('путь в мир мирного игрока ждёт ответа: окно с именем, приказа нет', async () => {
    const { go, env, foe, fleet } = await boot();
    const prompt = fakePrompt();
    const before = env.world;
    go.tryMoveGroup([fleet.id], foe.id);
    expect(go.warPrompt).toEqual({ fleetIds: [fleet.id], destId: foe.id, blockers: ['p2'] });
    expect(env.world).toBe(before);
    expect(prompt.shown()).toBe(true);
    // Имя виновника — чужой ввод в разметке: экранировано.
    expect(prompt.el.innerHTML).toContain('&lt;B&amp;&gt;');
    expect(prompt.el.innerHTML).not.toContain('<B&>');
  });

  it('подтверждение: сперва война, потом ход; окно закрыто, в ленте объявление', async () => {
    const { go, env, foe, fleet } = await boot();
    const prompt = fakePrompt();
    go.tryMoveGroup([fleet.id], foe.id);
    go.confirmWarPrompt();
    expect(getStance(env.world, 'p1', 'p2')).toBe('war');
    expect(journeyDestination(env.world.fleets[fleet.id]!.movement!)).toBe(foe.id);
    expect(go.warPrompt).toBeNull();
    expect(prompt.shown()).toBe(false);
    expect(env.notes.at(-1)).toEqual([t('log.war.declared'), undefined]);
    // Повторное подтверждение пустого окна ничего не издаёт.
    const after = env.world;
    go.confirmWarPrompt();
    expect(env.world).toBe(after);
  });

  it('отмена: окно закрыто, мир не тронут, война не объявлена', async () => {
    const { go, env, foe, fleet } = await boot();
    const prompt = fakePrompt();
    const before = env.world;
    go.tryMoveGroup([fleet.id], foe.id);
    go.cancelWarPrompt();
    expect(go.warPrompt).toBeNull();
    expect(prompt.shown()).toBe(false);
    expect(env.world).toBe(before);
    expect(getStance(env.world, 'p1', 'p2')).toBe('peace');
  });

  it('марш на лейн упирается в оба конца: конец у мирного — окно с краем', async () => {
    const { go, foe, fleet } = await boot();
    fakePrompt();
    const edge = { from: foe.links![0]!, to: foe.id, t: 0.5 };
    go.tryMoveEdgeGroup([fleet.id], edge);
    expect(go.warPrompt).toEqual({ fleetIds: [fleet.id], destId: foe.id, edge, blockers: ['p2'] });
  });
});

describe('REFM-228 — штурм группой', () => {
  it('мир мирного игрока: окно войны о штурме, владелец цели среди виновников', async () => {
    const { go, foe, fleet } = await boot();
    const prompt = fakePrompt();
    go.tryAssaultGroup([fleet.id], foe.id);
    expect(go.warPrompt).toEqual({
      fleetIds: [fleet.id],
      destId: foe.id,
      blockers: ['p2'],
      assault: true,
    });
    expect(prompt.el.innerHTML).toContain('wp-yes');
  });

  it('стоящий у мира мирного игрока: путь свободен, но высадка требует войны', async () => {
    const { go, env, foe, fleet } = await boot();
    fakePrompt();
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [fleet.id]: { ...fleet, location: foe.id } },
    };
    go.tryAssaultGroup([fleet.id], foe.id);
    expect(go.warPrompt).toEqual({
      fleetIds: [fleet.id],
      destId: foe.id,
      blockers: ['p2'],
      assault: true,
    });
  });

  it('летящему штурм уходит в ядро цепочкой «дойти → штурмовать»', async () => {
    const { go, env, foe, fleet } = await boot();
    fakePrompt();
    env.world = { ...env.world, diplomacy: { ...env.world.diplomacy, 'p1|p2': 'war' } };
    go.tryAssaultGroup([fleet.id], foe.id);
    expect(go.warPrompt).toBeNull();
    const plan = env.world.orders?.[fleet.id];
    expect(plan?.steps.map((s) => s.kind)).toEqual(['move', 'assault']);
    expect(plan?.steps[0]).toMatchObject({ to: foe.id });
    // Гарнизон у цели есть, десанта нет — одно предупреждение на группу, привязанное к цели.
    expect(env.notes).toEqual([[t('log.assault.warn-no-troops'), foe.id]]);
  });

  it('стоящему у цели ядро отвечает сейчас: свой мир — отказ в ленте, приказа нет', async () => {
    const { go, env, home, fleet } = await boot();
    fakePrompt();
    const before = env.world;
    go.tryAssaultGroup([fleet.id], home.id);
    expect(env.world).toBe(before);
    expect(env.notes).toHaveLength(1);
    expect(env.notes[0]![0]).toMatch(/^✖ /);
    expect(env.notes[0]![1]).toBe(home.id);
  });
});

describe('REFM-228 — слияние', () => {
  it('стоящие вместе сливаются сразу, выбор — на якоре, в ленте итог', async () => {
    const { go, env, fleet } = await boot();
    addFleet(env, fleet, 'p1-x');
    go.orderMerge(['p1-x'], fleet.id);
    expect(env.world.fleets['p1-x']).toBeUndefined();
    expect(env.world.fleets[fleet.id]?.units.find((u) => u.unit === 'cruiser')?.count).toBe(3);
    expect(env.selected).toEqual([[fleet.id]]);
    expect(env.notes.at(-1)?.[0]).toBe('⛬ fleets merged');
  });

  it('далёкий летит к якорю и несёт намерение слиться', async () => {
    const { go, env, home, fleet } = await boot();
    addFleet(env, fleet, 'p1-x', home.links![0]!);
    go.orderMerge(['p1-x'], fleet.id);
    const mover = env.world.fleets['p1-x']!;
    expect(mover.movement?.to).toBe(home.id);
    expect((mover as { mergeInto?: string }).mergeInto).toBe(fleet.id);
    expect(env.notes.at(-1)?.[0]).toBe('⛬ 1 fleet(s) en route to merge');
  });

  it('кнопка группы берёт якорем стоящего, одиночку не сливает', async () => {
    const { go, env, home, fleet } = await boot();
    addFleet(env, fleet, 'p1-x');
    go.tryMoveGroup(['p1-x'], home.links![0]!);
    go.mergeGroup(['p1-x']);
    expect(env.notes).toEqual([]);
    go.mergeGroup(['p1-x', fleet.id]); // первый в списке летит — якорь второй, стоящий
    const mover = env.world.fleets['p1-x']!;
    expect(journeyDestination(mover.movement!)).toBe(home.id);
    expect((mover as { mergeInto?: string }).mergeInto).toBe(fleet.id);
    expect(env.selected).toEqual([[fleet.id]]);
  });
});

describe('REFM-228 — авто-штурм и отход', () => {
  it('соло: стойка у владельца, чужой флот пропущен, смешанная группа — одним состоянием', async () => {
    const { go, env, fleet } = await boot();
    addFleet(env, fleet, 'p1-x');
    go.setAutoAssault([fleet.id, 'p2-1'], true);
    expect([...go.soloAutoAssault]).toEqual([fleet.id]);
    expect(go.isAutoAssault('p2-1')).toBe(false);
    go.setAutoAssault([fleet.id, 'p1-x'], true);
    expect(new Set(go.soloAutoAssault)).toEqual(new Set([fleet.id, 'p1-x']));
    go.setAutoAssault([fleet.id], false);
    expect(go.isAutoAssault(fleet.id)).toBe(false);
  });

  it('смена матча забывает стойки, загрузка сохранения их возвращает', async () => {
    const { go, fleet } = await boot();
    go.setAutoAssault([fleet.id], true);
    go.forgetAutoAssault();
    expect(go.soloAutoAssault.size).toBe(0);
    go.restoreAutoAssault([fleet.id, 'p1-x']);
    expect(go.isAutoAssault('p1-x')).toBe(true);
  });

  it('сеть: стойка — из состояния, переключение уходит приказом, локальный набор пуст', async () => {
    const sent: Action[] = [];
    vi.doMock('./netSession', () => ({
      NET: true,
      reconnecting: false,
      netClient: { sendAction: (a: Action) => sent.push(a) },
    }));
    try {
      const { go, env, fleet } = await boot();
      env.world = { ...env.world, autoAssault: { [fleet.id]: true } } as GameState;
      expect(go.isAutoAssault(fleet.id)).toBe(true);
      expect(go.isAutoAssault('p2-1')).toBe(false);
      go.setAutoAssault([fleet.id], true); // уже стоит — приказа нет
      go.setAutoAssault([fleet.id], false);
      expect(sent.map((a) => [a.type, a.payload])).toEqual([
        ['order.auto', { fleetId: fleet.id, on: false }],
      ]);
      expect(go.soloAutoAssault.size).toBe(0);
    } finally {
      vi.doUnmock('./netSession');
    }
  });

  it('порог авто-отхода читается из состояния', async () => {
    const { go, env, fleet } = await boot();
    expect(go.autoRetreatAt(fleet.id)).toBeNull();
    env.world = { ...env.world, autoRetreat: { [fleet.id]: { at: 0.5 } } } as GameState;
    expect(go.autoRetreatAt(fleet.id)).toBe(0.5);
  });
});

describe('REFM-228 — погрузка десанта', () => {
  it('у своего мира — наземные части гарнизона, трюм и обещанные подъёмы', async () => {
    const { go, env, home, fleet } = await boot();
    // Подъёмы этого флота: два ополченца отсюда, один с другого мира и танк — он вдвое
    // объёмнее. Обещанное считается по миру, откуда поднимают, а трюм — по объёму.
    const claim = (unit: string, count: number, from: string) => ({
      unit,
      count,
      from,
      startAt: 0,
      doneAt: 1,
    });
    const loading = [
      claim('militia', 2, home.id),
      claim('militia', 1, 'elsewhere'),
      claim('tank', 1, 'elsewhere'),
    ];
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [fleet.id]: { ...fleet, loading } },
    };
    const input = go.troopsInputFor(fleet.id)!;
    expect(input.units.map((u) => u.unit).sort()).toEqual(['heavy_infantry', 'militia']);
    const militia = input.units.find((u) => u.unit === 'militia')!;
    expect([militia.queued, militia.reserved, militia.hold]).toEqual([3, 2, 0]);
    expect(input.reservedCargo).toBe(2 + 1 + 2);
    expect(input.plan).toEqual({});
  });

  it('флот в пути или чужой мир без трюма — меню нет', async () => {
    const { go, env, home, foe, fleet } = await boot();
    const to = home.links![0]!;
    go.tryMoveGroup([fleet.id], to);
    expect(go.troopsInputFor(fleet.id)).toBeNull();
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [fleet.id]: { ...fleet, location: foe.id } },
    };
    expect(go.troopsInputFor(fleet.id)).toBeNull();
    expect(go.troopsInputFor('gone')).toBeNull();
    // У своего мира, но в бою — не пришвартован: меню нет.
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [fleet.id]: { ...fleet, battleId: 'b1' } },
    };
    expect(go.troopsInputFor(fleet.id)).toBeNull();
  });

  it('гарнизон под штурмом войска не отпускает — строка в ленте', async () => {
    const { go, env, home } = await boot();
    expect(go.troopsLiftable(home.id)).toBe(true);
    const battle = { sides: [{ ref: { kind: 'garrison', planetId: home.id } }] };
    env.world = { ...env.world, battles: { b1: battle } } as unknown as GameState;
    expect(go.troopsLiftable(home.id)).toBe(false);
    expect(env.notes).toEqual([['✖ ' + t('cargo.under-assault'), undefined]]);
  });
});

describe('REFM-228 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const GO = readFileSync(new URL('./groupOrders.ts', import.meta.url), 'utf8');
  const init = /initGroupOrders\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, своё место, лента, имя из таблицы мест, смена выбора', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'note,',
      'seatName: (id) => NAME[id],',
      'selectFleets: setFleetSelection,',
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('чужие зоны пишут стойку и окно только дверями', () => {
    expect(MAIN).toContain('forgetAutoAssault();');
    expect(MAIN).toContain('restoreAutoAssault(save.autoAssault);');
    expect(MAIN).toContain('autoAssault: [...soloAutoAssault]');
    expect(MAIN).toContain('autoAssault: (id) => soloAutoAssault.has(id),');
    expect(MAIN).not.toMatch(/\bautoAssault\.(add|delete|clear|has)\(|\bwarPrompt = /);
  });

  it('приказы группе живут у владельца, `main.ts` только зовёт их', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (tryMoveGroup|tryAssaultGroup|tryMoveEdgeGroup|dispatchAssault|confirmWarPrompt|cancelWarPrompt|renderWarPrompt|orderMerge|mergeGroup|isAutoAssault|setAutoAssault|autoRetreatAt|troopsInputFor|troopsLiftable|peaceBlockers?)\(/,
    );
    expect(GO).not.toMatch(/from '\.\/main'/);
  });
});

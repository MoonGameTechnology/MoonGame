import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, netIncome, advance, aiOrders, HOUR } from './game';
import { networkSeats } from './matchSetup';
import { resourceCardHtml } from './resourceCard';
import { data } from './gameData';
import { openTurn } from './aiTurn/turn';
import { investOrder } from './aiTurn/economy';
import { controlLimitOf, incomeBreakdown } from './economy';
import { createDossiers, type DossierHost } from './dossiers';
import { traceHooks } from './protoKernel';
import { DAY } from './time';
import {
  CONTROL_LIMIT,
  INTEGRATION_HOURS,
  isInhabited,
  uncontrolledPlanets,
  type GameState,
} from '../../packages/shared-core/src/index';

beforeAll(() => setLocale('ru'));

/** p1 holds exactly `n` planets: its own plus unowned ones handed over. */
function empireOf(n: number, s: GameState = newGame()): GameState {
  const mine = (): number =>
    Object.values(s.planets).filter((p) => p.owner === 'p1' && isInhabited(data, p)).length;
  for (const p of Object.values(s.planets)) {
    if (mine() >= n) break;
    if (p.owner !== null || !isInhabited(data, p)) continue;
    p.owner = 'p1';
    p.garrison = []; // keep the HUD/settlement comparison free of militia upkeep noise
  }
  expect(mine()).toBe(n);
  return s;
}

describe('лимит управления в прототипе (BAL-19)', () => {
  it('HUD показывает тот же приток, что начисляет ядро, у державы за лимитом', () => {
    const s = empireOf(CONTROL_LIMIT + 3);
    expect(uncontrolledPlanets(s, data, 'p1', s.modeId).size).toBe(3);
    // Без столицы лимит не действует: тот же HUD показывает доход выше.
    const free = structuredClone(s);
    delete free.capital;
    expect(netIncome(free, 'p1').metal ?? 0).toBeGreaterThan(netIncome(s, 'p1').metal ?? 0);
    const after = advance(s, s.time + HOUR).state;
    // Кредиты — вместе с гражданским налогом, который лимит тоже режет.
    for (const res of ['metal', 'credits']) {
      const rate = netIncome(s, 'p1')[res] ?? 0;
      const gained = (after.players.p1!.resources[res] ?? 0) - (s.players.p1!.resources[res] ?? 0);
      expect(rate, res).toBeGreaterThan(0);
      expect(gained, res).toBeCloseTo(rate, 3);
    }
  });

  it('карточка ресурса называет планеты вне управления и молчит в пределах лимита', () => {
    const big = empireOf(CONTROL_LIMIT + 3);
    expect(resourceCardHtml(big, 'p1', 'metal', {}, false)).toContain(
      'Вне управления 3 планеты: доход с них 50%',
    );
    const small = empireOf(CONTROL_LIMIT);
    expect(resourceCardHtml(small, 'p1', 'metal', {}, false)).not.toContain('Вне управления');
  });

  it('бот держит базу под управлением, даже когда верфь осталась только за лимитом', () => {
    const s = empireOf(CONTROL_LIMIT + 1);
    const outside = uncontrolledPlanets(s, data, 'p1', s.modeId);
    expect(outside.size).toBe(1);
    const far = [...outside][0]!;
    const yard = (type: string): boolean => data.buildings[type]?.enablesShipConstruction === true;
    for (const p of Object.values(s.planets))
      if (p.owner === 'p1') p.buildings = p.buildings.filter((b) => !yard(b.type));
    const shipyard = Object.keys(data.buildings).find(yard)!;
    s.planets[far]!.buildings.push({ type: shipyard, level: 1, hp: 50 });
    // Дальняя планета — первой на карте: запасная ветка брала первый свой застроенный мир.
    s.planets = { [far]: s.planets[far]!, ...s.planets };
    const base = openTurn(s, 'p1', 'expand', 'strong', new Set())?.base;
    expect(base?.owner).toBe('p1');
    expect(outside.has(base!.id)).toBe(false);
  });

  it('бот вкладывает хозяйство сперва под управлением, потом за лимитом, в освоение — нет', () => {
    const s = empireOf(CONTROL_LIMIT + 2);
    const [far, taken] = [...uncontrolledPlanets(s, data, 'p1', s.modeId)];
    const ruled = Object.values(s.planets).find(
      (p) =>
        p.owner === 'p1' &&
        isInhabited(data, p) &&
        p.id !== s.capital?.p1 &&
        p.id !== far &&
        p.id !== taken,
    )!;
    s.planets[taken!]!.integration = {
      claim: 'p2',
      since: s.time,
      until: s.time + INTEGRATION_HOURS * HOUR,
    };
    const bot = openTurn(s, 'p1', 'expand', 'strong', new Set())!;
    const worlds = [s.planets[taken!]!, s.planets[far!]!, ruled];
    expect(investOrder(bot, worlds).map((p) => p.id)).toEqual([ruled.id, far]);
  });

  it('бот не ставит шахту на планету, которую ещё осваивает', () => {
    const s = empireOf(3);
    s.players.p1!.resources = {
      credits: 1e5,
      metal: 1e5,
      microelectronics: 1e4,
      food: 1e4,
      energy: 1e4,
    };
    const others = Object.values(s.planets).filter(
      (p) => p.owner === 'p1' && isInhabited(data, p) && p.id !== s.capital?.p1,
    );
    for (const p of others) {
      p.buildings = p.buildings.filter((b) => b.type !== 'mine');
      p.integration = { claim: 'p2', since: s.time, until: s.time + INTEGRATION_HOURS * HOUR };
    }
    const mines = (st: GameState): string[] =>
      aiOrders(st, 'p1', 'expand', 'strong')
        .filter(
          (a) =>
            a.type === 'building.construct' &&
            (a.payload as { building?: string }).building === 'mine',
        )
        .map((a) => (a.payload as { planetId: string }).planetId);
    expect(mines(s)).toEqual([]);
    // Освоение кончилось — планета своя целиком, и шахта идёт на неё.
    const done = structuredClone(s);
    for (const p of Object.values(done.planets)) delete p.integration;
    expect(mines(done)).toHaveLength(1);
  });
});

describe('технологии поднимают лимит управления (BAL-19, шаг 3)', () => {
  /** Узлы лимита есть только в дереве основной игры: карта на четверых, p1 держит `n` планет. */
  const mainEmpireOf = (n: number): GameState =>
    empireOf(n, newGame({ mapId: 'ffa-4', seats: networkSeats('ffa', 'ffa-4') }));
  /** p1 с изученными `ids` поверх того, что у него уже было. */
  const researched = (s: GameState, ...ids: string[]): GameState => {
    const done = s.players.p1!.technologies?.completed ?? [];
    s.players.p1!.technologies = { completed: [...done, ...ids] };
    return s;
  };
  const kernelLimit = (s: GameState): unknown =>
    traceHooks(s, [{ name: 'control.limit', base: CONTROL_LIMIT, args: { playerId: 'p1' } }])?.[0]
      ?.value;
  /** Три узла «Командования» с предками: лимит 10. */
  const COMMAND_LINE = [
    'signal_corps',
    'provincial_administration',
    'colonial_governance',
    'logistics_command',
    'imperial_chancery',
  ];
  /** Своя линия Наместника: +2 планеты и +10% содержания армии за узел. */
  const VICEROY_LINE = ['viceroyalties', 'military_governorates', 'imperial_protectorate'];
  /** Бот p1 на день `day` с полной казной, с советом `council` и изученными узлами первого
   *  яруса с юнитами: их бот берёт первыми всегда. */
  const botSeat = (s: GameState, day: number, council?: string[]): GameState => {
    s.time = (s.startedAt ?? 0) + day * DAY;
    delete s.players.p1!.scientist;
    if (council) s.players.p1!.scientists = council.map((id) => ({ id, level: 1 }));
    else delete s.players.p1!.scientists; // без совета у бота нет доктрины: порядок — по цене
    s.players.p1!.resources = {
      credits: 1e5,
      metal: 1e5,
      microelectronics: 1e4,
      food: 1e4,
      energy: 1e4,
    };
    const firstUnits = Object.keys(data.technologies).filter((id) => {
      const def = data.technologies[id]!;
      return def.ruleset === 'main' && def.tier === 1 && (def.unlocks.units?.length ?? 0) > 0;
    });
    return researched(s, ...firstUnits.filter((id) => id !== 'scout_design'));
  };
  /** Какой узел бот p1 ставит в исследование. */
  const pick = (st: GameState): string | undefined =>
    (
      aiOrders(st, 'p1', 'expand', 'strong').find((a) => a.type === 'technology.research')
        ?.payload as { technology?: string } | undefined
    )?.technology;

  it('три узла «Командования» поднимают лимит до 10, и хост видит тот же лимит, что ядро', () => {
    const s = mainEmpireOf(CONTROL_LIMIT + 3);
    expect(controlLimitOf(s, 'p1')).toBe(5);
    expect(kernelLimit(s)).toBe(5);
    researched(s, 'signal_corps', 'provincial_administration');
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([6, 6]);
    researched(s, 'colonial_governance');
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([8, 8]);
    researched(s, 'logistics_command', 'imperial_chancery');
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([10, 10]);
  });

  it('под поднятым лимитом HUD, карточка ресурса и ядро видят планеты целиком', () => {
    const s = researched(
      mainEmpireOf(CONTROL_LIMIT + 3),
      'signal_corps',
      'provincial_administration',
      'colonial_governance',
    );
    expect(uncontrolledPlanets(s, data, 'p1', s.modeId, controlLimitOf(s, 'p1')).size).toBe(0);
    expect(resourceCardHtml(s, 'p1', 'metal', {}, false)).not.toContain('Вне управления');
    const after = advance(s, s.time + HOUR).state;
    for (const res of ['metal', 'credits']) {
      const rate = netIncome(s, 'p1')[res] ?? 0;
      const gained = (after.players.p1!.resources[res] ?? 0) - (s.players.p1!.resources[res] ?? 0);
      expect(gained, res).toBeCloseTo(rate, 3);
    }
    // Один узел из трёх: лимит 6, две планеты из восьми всё ещё за ним.
    const partly = researched(
      mainEmpireOf(CONTROL_LIMIT + 3),
      'signal_corps',
      'provincial_administration',
    );
    expect(resourceCardHtml(partly, 'p1', 'metal', {}, false)).toContain(
      'Вне управления 2 планеты: доход с них 50%',
    );
  });

  it('досье «Вне управления» называет лимит смотрящего', () => {
    const s = researched(
      mainEmpireOf(CONTROL_LIMIT + 3),
      'signal_corps',
      'provincial_administration',
    );
    const host: DossierHost = {
      state: () => s,
      me: () => 'p1',
      pcUi: () => true,
      youColor: () => '#3ad17a',
      queuedOrders: () => [],
      activeConstruction: () => null,
      progressPct: () => 0,
      victoryPoints: () => true,
    };
    expect(createDossiers(host).objDossier('fact:uncontrolled')?.body).toContain(
      'Под управлением 6 планет',
    );
  });

  it('бот с планетами за лимитом изучает узел, поднимающий лимит, раньше более дешёвых', () => {
    // День 3 — ворота «Провинциальной администрации».
    const s = researched(botSeat(mainEmpireOf(CONTROL_LIMIT + 3), 3), 'signal_corps');
    expect(pick(s)).toBe('provincial_administration');
    // В пределах лимита узел — один из многих, и первым идёт более дешёвый.
    const small = structuredClone(s);
    for (const id of uncontrolledPlanets(s, data, 'p1', s.modeId)) small.planets[id]!.owner = null;
    expect(pick(small)).not.toBe('provincial_administration');
  });

  it('линия Наместника поднимает лимит до 16, и хост видит тот же лимит, что ядро', () => {
    const s = researched(mainEmpireOf(CONTROL_LIMIT + 3), ...COMMAND_LINE);
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([10, 10]);
    researched(s, 'viceroyalties');
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([12, 12]);
    researched(s, 'military_governorates', 'imperial_protectorate');
    expect([controlLimitOf(s, 'p1'), kernelLimit(s)]).toEqual([16, 16]);
  });

  it('надбавку к содержанию армии HUD и карточка ресурса считают так же, как ядро', () => {
    const withArmy = (...ids: string[]): GameState => {
      const s = researched(mainEmpireOf(CONTROL_LIMIT), ...ids);
      Object.values(s.fleets).find((f) => f.owner === 'p1')!.units = [
        { unit: 'cruiser', count: 10 },
      ];
      return s;
    };
    const unitUpkeep = (s: GameState): number => incomeBreakdown(s, 'p1').credits?.unitUpkeep ?? 0;
    const plain = withArmy(...COMMAND_LINE);
    const dear = withArmy(...COMMAND_LINE, ...VICEROY_LINE);
    expect(unitUpkeep(plain)).toBeGreaterThan(0);
    expect(unitUpkeep(dear)).toBeCloseTo(unitUpkeep(plain) * 1.3, 9);
    const after = advance(dear, dear.time + HOUR).state;
    for (const res of ['credits', 'food']) {
      const rate = netIncome(dear, 'p1')[res] ?? 0;
      const gained =
        (after.players.p1!.resources[res] ?? 0) - (dear.players.p1!.resources[res] ?? 0);
      expect(gained, res).toBeCloseTo(rate, 3);
    }
  });

  it('бот с Наместником и планетами за лимитом идёт в его линию', () => {
    const s = researched(
      botSeat(mainEmpireOf(10 + 3), 12, ['viceroy', 'polymath']),
      ...COMMAND_LINE,
    );
    expect(pick(s)).toBe('viceroyalties');
  });

  it('Куратор без Наместника не ведёт доктрину в его линию', () => {
    // Высший тир «Командования» теперь у линии Наместника. Куратору она закрыта, и путь его
    // доктрины ведёт к высшему тиру, который ему открыт: второй герой идёт раньше дешёвого
    // дрона, хотя оба — узлы его ветки.
    const s = researched(
      botSeat(mainEmpireOf(CONTROL_LIMIT), 5, ['overseer', 'polymath']),
      'signal_corps',
      'flagship_command',
      'provincial_administration',
      'colonial_governance',
      'logistics_command',
      'industrial_automation',
      'deep_survey',
      'picket_design',
      'deep_range_network',
    );
    expect(pick(s)).toBe('hero_command_ii');
  });
});

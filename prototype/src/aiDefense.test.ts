// AI-BAL-2: оборона и удержание миров у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. В базовой линии мертвы были `fort`, `hospital`, `orbital_aa`, а
// миры переходили из рук в руки по 113 раз за матч — и почти все переходы шли ПРИЛЁТОМ:
// `captureOnArrival` не смотрит ни на здания, ни на их оборонный бонус, только на
// `garrison.some(count > 0)`. Поэтому «удержание» здесь — это ДВА разных механизма, и
// тесты держат оба порознь:
//   • гарнизон на занятом мире (флот оставляет одного бойца) — он и запрещает прилёт;
//   • оборонительные здания — они делают ШТУРМ дорогим (`defenseBonus` через хук
//     `combat.damage`, `healRate` между штурмами, `aaDamage` по флоту на орбите).
//
// Оборона строится только НА ВОЙНЕ. Это не вкус: в мирное время та же цепочка укорачивала
// матч (4.7 → 3.6 дня) и вдвое срезала флот — у зданий есть `scoreValue`, поэтому бот
// начинал выигрывать гонку ОЧКОВ постройками вместо того, чтобы воевать.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { data } from './gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const builtTypes = (actions: Action[]): string[] =>
  only(actions, 'building.construct').map((a) => (a.payload as { building: string }).building);
const unloads = (actions: Action[]): Array<{ unit: string; count: number }> =>
  only(actions, 'army.unload').map(
    (a) => a.payload as { fleetId: string; unit: string; count: number },
  );

const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => data.buildings[b.type]?.enablesShipConstruction),
  )!.id;

/** Состояние в состоянии войны + богатая казна: оборона должна быть ПО КАРМАНУ, иначе
 *  тест мерил бы бедность бота, а не его правило. */
function atWar(s: GameState): GameState {
  return {
    ...s,
    diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 4000, metal: 6000, food: 500, energy: 500, microelectronics: 200 },
      },
    },
  };
}

describe('AI-BAL-2 — оборонительные здания (тест-профиль)', () => {
  it('на войне ставит ФОРТ на призовом мире', () => {
    expect(builtTypes(aiOrders(atWar(game2()), 'p2', 'expand', 'strong'))).toContain('fort');
  });

  it('в мирное время оборону не строит — иначе выигрывает гонку очков вместо войны', () => {
    const rich: GameState = {
      ...game2(),
      players: {
        ...game2().players,
        p2: {
          ...game2().players.p2!,
          resources: { credits: 4000, metal: 6000, food: 500, energy: 500, microelectronics: 200 },
        },
      },
    };
    const types = builtTypes(aiOrders(rich, 'p2', 'expand', 'strong'));
    for (const b of ['fort', 'hospital', 'orbital_aa']) expect(types).not.toContain(b);
  });

  // ORB-1. Орбитальное ПКО ушло за технологию, и звено цепочки стало ЗАПИРАЕМЫМ.
  // Критерий «не построено и не в очереди» держал бы его вечно: бот заказывал бы
  // батарею каждый тик, получал `E_TECH_LOCKED` и никогда не доходил бы до зонального
  // ПВО за ним. Поэтому цепочка спрашивает ядро (`canOrder`), а не переводит правило
  // заново — и перешагивает то, чего пока нельзя.
  it('ЗАПЕРТОЕ ЗВЕНО ПЕРЕШАГИВАЕТСЯ: без технологии ПКО не заказывается, но цепочка идёт дальше', () => {
    const s = atWar(game2());
    const home = homeOf(s, 'p2');
    const withPair: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [home]: {
          ...s.planets[home]!,
          buildings: [
            ...s.planets[home]!.buildings,
            { type: 'fort', level: 1, hp: 40 },
            { type: 'hospital', level: 1, hp: 40 },
          ],
        },
      },
    };
    const types = builtTypes(aiOrders(withPair, 'p2', 'expand', 'strong'));
    expect(types).not.toContain('orbital_aa'); // заперто технологией
    expect(types).toContain('zonal_aa'); // а следующее звено бот всё-таки видит
  });

  it('цепочка идёт по порядку: форт стоит → заказывается госпиталь', () => {
    const s = atWar(game2());
    const home = homeOf(s, 'p2');
    const withFort: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [home]: {
          ...s.planets[home]!,
          buildings: [...s.planets[home]!.buildings, { type: 'fort', level: 1, hp: 40 }],
        },
      },
    };
    const types = builtTypes(aiOrders(withFort, 'p2', 'expand', 'strong'));
    expect(types).toContain('hospital');
    expect(types).not.toContain('fort'); // дважды одно и то же не заказывается
  });

  it('ИГРОВОЙ бот обороны не строит даже на войне', () => {
    const types = builtTypes(aiOrders(atWar(game2()), 'p2', 'expand'));
    for (const b of ['fort', 'hospital', 'orbital_aa']) expect(types).not.toContain(b);
  });
});

describe('AI-BAL-2 — гарнизон на занятом мире', () => {
  /** Свой мир БЕЗ гарнизона + флот на нём с десантом в трюме. */
  function heldEmpty(s: GameState, landingCount: number): GameState {
    const spare = Object.values(s.planets).find((p) => p.owner === null && p.kind === 'planet')!;
    return {
      ...s,
      planets: { ...s.planets, [spare.id]: { ...spare, owner: 'p2', garrison: [] } },
      fleets: {
        'f:hold': {
          id: 'f:hold',
          owner: 'p2',
          location: spare.id,
          units: [{ unit: 'cruiser', count: 1 }],
          landing: landingCount > 0 ? [{ unit: 'militia', count: landingCount }] : [],
          traits: [],
          movement: null,
          orbit: 'near',
        } as GameState['fleets'][string],
      },
    };
  }

  it('ССАЖИВАЕТ ДО ПОЛА, а не ровно одного бойца', () => {
    // Правило владельца №4 (2026-09-16), вторая половина. Раньше оставляли одного и
    // объясняли это тем, что «остальной десант нужен самому флоту». Довод верен лишь
    // наполовину: нужен ровно тот десант, которым флот РЕАЛЬНО возьмёт свою цель, а
    // всё сверх того он просто возит — и теряет вместе с корпусами.
    // Пол голого мира — 16 очков обороны, ополченец даёт 8, значит сходят двое.
    const dropped = unloads(aiOrders(heldEmpty(game2(), 4), 'p2', 'expand', 'strong'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.count).toBe(2);
  });

  it('НЕДОБОР ДОБИРАЕТСЯ: мир с одним бойцом всё ещё ниже пола', () => {
    const s = heldEmpty(game2(), 4);
    const held = Object.values(s.planets).find((p) => p.owner === 'p2' && p.garrison.length === 0)!;
    const partly: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [held.id]: { ...held, garrison: [{ unit: 'militia', count: 1 }] },
      },
    };
    const dropped = unloads(aiOrders(partly, 'p2', 'expand', 'strong'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.count).toBe(1); // 8 очков недобора — один ополченец
  });

  it('НА ПОЛУ НЕ РАЗГРУЖАЕТСЯ — подвоз не сыплет туда, где и так хватает', () => {
    const s = heldEmpty(game2(), 4);
    const held = Object.values(s.planets).find((p) => p.owner === 'p2' && p.garrison.length === 0)!;
    const full: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [held.id]: { ...held, garrison: [{ unit: 'militia', count: 2 }] },
      },
    };
    expect(unloads(aiOrders(full, 'p2', 'expand', 'strong'))).toHaveLength(0);
  });

  it('ДЕСАНТ ПОД ЦЕЛЬ НЕ РАЗДАЁТСЯ: рядом обороняемый чужой мир — трюм остаётся целым', () => {
    // Граница правила: ссаживать можно лишь то, без чего флот ВСЁ РАВНО возьмёт свою
    // ближайшую цель. Спрашивается та же `confidentGroundWin`, которой меряет себя сам
    // штурм, поэтому «раздал гарнизон и не взял мир» получиться не может.
    const s = heldEmpty(game2(), 4);
    const held = Object.values(s.planets).find((p) => p.owner === 'p2' && p.garrison.length === 0)!;
    const withFoe: GameState = {
      ...s,
      diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
      planets: Object.fromEntries(
        Object.entries(s.planets).map(([id, p]) => [
          id,
          // Каждый чужой захватываемый мир держит роту: взять его четырьмя ополченцами
          // нельзя ни при каком раскладе, и раздавать их бот не станет.
          p.owner !== 'p2' && p.kind === 'planet'
            ? { ...p, owner: 'p1', garrison: [{ unit: 'heavy_infantry', count: 8 }] }
            : p,
        ]),
      ),
    };
    withFoe.planets[held.id] = { ...withFoe.planets[held.id]!, owner: 'p2', garrison: [] };
    expect(unloads(aiOrders(withFoe, 'p2', 'expand', 'strong'))).toHaveLength(0);
  });

  it('пустой трюм — нечего оставлять, приказа нет', () => {
    expect(unloads(aiOrders(heldEmpty(game2(), 0), 'p2', 'expand', 'strong'))).toHaveLength(0);
  });

  it('ИГРОВОЙ бот гарнизоны не расставляет', () => {
    expect(unloads(aiOrders(heldEmpty(game2(), 4), 'p2', 'expand'))).toHaveLength(0);
  });
});

describe('ПОДВОЗ ПОДКРЕПЛЕНИЯ — вторая половина правила №4 (2026-09-16)', () => {
  /**
   * Свой мир с ИЗЛИШКОМ и флот с пустым трюмом на нём + свой мир НИЖЕ ПОЛА поодаль.
   * Замер показал, что это и есть типичная картина у бота: войска есть, но не там —
   * 179 миров ниже пола на 2432 очка при излишке 23004 очка на 1619 других.
   */
  function surplusAndNeed(s: GameState): { st: GameState; rich: string; poor: string } {
    const free = Object.values(s.planets).filter((p) => p.owner === null && p.kind === 'planet');
    const rich = free[0]!;
    const poor = free[1]!;
    const st: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [rich.id]: { ...rich, owner: 'p2', garrison: [{ unit: 'militia', count: 9 }] },
        [poor.id]: { ...poor, owner: 'p2', garrison: [] },
      },
      fleets: {
        'f:ferry': {
          id: 'f:ferry',
          owner: 'p2',
          location: rich.id,
          units: [{ unit: 'cruiser', count: 1 }],
          landing: [],
          traits: [],
          movement: null,
        } as GameState['fleets'][string],
      },
    };
    return { st, rich: rich.id, poor: poor.id };
  }

  const loadsOf = (actions: Action[]) =>
    actions
      .filter((a) => a.type === 'army.load')
      .map((a) => a.payload as { fleetId: string; unit: string; count: number });

  it('ИЗЛИШЕК ГРУЗИТСЯ, когда своему миру не хватает', () => {
    const { st } = surplusAndNeed(game2());
    const lifted = loadsOf(aiOrders(st, 'p2', 'expand', 'strong'));
    expect(lifted.length).toBeGreaterThan(0);
    expect(lifted.every((l) => l.fleetId === 'f:ferry')).toBe(true);
    // Досуха не вычерпывает: пол мира (16 очков = два ополченца) остаётся на месте.
    expect(lifted.reduce((n, l) => n + l.count, 0)).toBeLessThanOrEqual(7);
  });

  it('НЕКОМУ ВЕЗТИ — не грузит: все свои миры на полу', () => {
    const { st, poor } = surplusAndNeed(game2());
    const filled: GameState = {
      ...st,
      planets: {
        ...st.planets,
        [poor]: { ...st.planets[poor]!, garrison: [{ unit: 'militia', count: 2 }] },
      },
    };
    expect(loadsOf(aiOrders(filled, 'p2', 'expand', 'strong'))).toHaveLength(0);
  });

  it('УДАРНУЮ ГРУППУ НЕ РАЗОРУЖАЕТ: флот с десантом на борту подвозом не занимают', () => {
    // Пустой трюм в условии — именно эта граница. Иначе правило перехватывало бы
    // гружёный десантом флот и превращало штурм в развозку ополчения.
    const { st } = surplusAndNeed(game2());
    const loaded: GameState = {
      ...st,
      fleets: {
        'f:ferry': { ...st.fleets['f:ferry']!, landing: [{ unit: 'tank', count: 3 }] },
      },
    };
    expect(loadsOf(aiOrders(loaded, 'p2', 'expand', 'strong'))).toHaveLength(0);
  });

  it('КУРС ВЕДЁТ К НУЖДАЮЩЕМУСЯ МИРУ, если цель этим десантом всё равно не взять', () => {
    const { st, rich, poor } = surplusAndNeed(game2());
    const carrying: GameState = {
      ...st,
      diplomacy: { ...(st.diplomacy ?? {}), 'p1|p2': 'war' },
      fleets: {
        'f:ferry': {
          ...st.fleets['f:ferry']!,
          location: rich,
          landing: [{ unit: 'militia', count: 3 }],
        },
      },
      // Гарнизон ставится КАЖДОМУ чужому узлу, а не только мирам вида `planet`.
      // Первая попытка этого теста поставила его только мирам — и флот честно ушёл на
      // ближайшую пустую ТУМАННОСТЬ: она захватываемая и берётся без боя, так что
      // «цель не взять» было неправдой, а правило не сработало верно.
      planets: Object.fromEntries(
        Object.entries(st.planets).map(([id, p]) => [
          id,
          p.owner !== 'p2'
            ? { ...p, owner: 'p1', garrison: [{ unit: 'heavy_infantry', count: 8 }] }
            : p,
        ]),
      ),
    };
    carrying.planets[poor] = { ...carrying.planets[poor]!, owner: 'p2', garrison: [] };
    carrying.planets[rich] = { ...carrying.planets[rich]!, owner: 'p2', garrison: [{ unit: 'militia', count: 9 }] };
    const moves = aiOrders(carrying, 'p2', 'expand', 'strong')
      .filter((a) => a.type === 'fleet.move')
      .map((a) => a.payload as { fleetId: string; to: string })
      .filter((m) => m.fleetId === 'f:ferry');
    expect(moves).toHaveLength(1);
    expect(moves[0]!.to).toBe(poor);
  });

  it('УВЕРЕННЫЙ ФЛОТ ПРАВИЛО НЕ ТРОГАЕТ — он идёт воевать, а не развозить', () => {
    const { st, rich, poor } = surplusAndNeed(game2());
    const strike: GameState = {
      ...st,
      diplomacy: { ...(st.diplomacy ?? {}), 'p1|p2': 'war' },
      fleets: {
        'f:ferry': {
          ...st.fleets['f:ferry']!,
          location: rich,
          landing: [{ unit: 'tank', count: 12 }], // этим берут что угодно
        },
      },
    };
    strike.planets[poor] = { ...strike.planets[poor]!, owner: 'p2', garrison: [] };
    const moves = aiOrders(strike, 'p2', 'expand', 'strong')
      .filter((a) => a.type === 'fleet.move')
      .map((a) => a.payload as { fleetId: string; to: string })
      .filter((m) => m.fleetId === 'f:ferry');
    expect(moves.every((m) => m.to !== poor)).toBe(true);
  });
});

describe('ГАРНИЗОН ПРИЗОВЫХ МИРОВ — стройка и войска в разных очередях', () => {
  /**
   * До 2026-09-16 ветка казармы выходила из ВСЕГО цикла призовых миров, и за тик бот
   * заказывал ЛИБО одну казарму, ЛИБО одну пару ополченцев — на всю империю. Первым в
   * обходе то и дело оказывался мир без казармы, и тогда гарнизон не заказывался НИГДЕ.
   * Замер: 1498 заказов казармы против 538 заказов ополчения при том, что большинство
   * голодных миров казарму уже имели.
   */
  function empire(): { st: GameState; bare: string; armed: string[] } {
    const s = atWar(game2());
    const free = Object.values(s.planets).filter((p) => p.owner === null && p.kind === 'planet');
    const bare = free[0]!;
    const armed = free.slice(1, 4);
    const planets = { ...s.planets, [bare.id]: { ...bare, owner: 'p2', garrison: [] } };
    for (const p of armed) {
      planets[p.id] = {
        ...p,
        owner: 'p2',
        garrison: [], // ниже пола
        buildings: [{ type: 'barracks', level: 1, hp: data.buildings.barracks!.hp }],
      };
    }
    return {
      st: {
        ...s,
        planets,
        players: {
          ...s.players,
          p2: {
            ...s.players.p2!,
            resources: { credits: 9000, metal: 9000, food: 900, energy: 900, microelectronics: 600 },
          },
        },
      },
      bare: bare.id,
      armed: armed.map((p) => p.id),
    };
  }

  it('КАЗАРМА НЕ СЪЕДАЕТ ТИК: в один тик идут и стройка, и гарнизон', () => {
    const { st, bare, armed } = empire();
    const orders = aiOrders(st, 'p2', 'expand', 'strong');
    const barracks = orders
      .filter((a) => a.type === 'building.construct')
      .map((a) => a.payload as { planetId: string; building: string })
      .filter((p) => p.building === 'barracks');
    const militia = orders
      .filter((a) => a.type === 'unit.build')
      .map((a) => a.payload as { planetId: string; unit: string })
      .filter((p) => p.unit === 'militia' && armed.includes(p.planetId));
    expect(barracks.map((b) => b.planetId)).toContain(bare);
    expect(militia.length).toBeGreaterThan(0);
  });

  it('СТРОЙКА ПРИЗОВЫХ МИРОВ ПО-ПРЕЖНЕМУ ОДНА ЗА ТИК — послабление касалось гарнизона', () => {
    // Счёт ведётся по ПРИЗОВЫМ мирам: дом застраивает своё правило (цеха `GROUND_YARDS`),
    // и его казарма к этому капу отношения не имеет.
    const { st } = empire();
    const home = Object.values(st.planets).find(
      (p) => p.owner === 'p2' && p.buildings.some((b) => data.buildings[b.type]?.enablesShipConstruction),
    )!;
    const barracks = aiOrders(st, 'p2', 'expand', 'strong')
      .filter((a) => a.type === 'building.construct')
      .map((a) => a.payload as { planetId: string; building: string })
      .filter((p) => p.building === 'barracks' && p.planetId !== home.id);
    expect(barracks).toHaveLength(1);
  });

  it('ГАРНИЗОН ЗАКАЗЫВАЕТСЯ НЕСКОЛЬКИМ МИРАМ, но не всем сразу: казна меряется до тика', () => {
    const { st, armed } = empire();
    const militia = aiOrders(st, 'p2', 'expand', 'strong')
      .filter((a) => a.type === 'unit.build')
      .map((a) => a.payload as { planetId: string; unit: string })
      .filter((p) => p.unit === 'militia' && armed.includes(p.planetId));
    expect(militia.length).toBeGreaterThan(1);
    expect(militia.length).toBeLessThanOrEqual(3);
  });
});

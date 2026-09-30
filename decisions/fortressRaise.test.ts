/**
 * ПРИЁМКА РЕШЕНИЯ О КНОПКЕ КРЕПОСТИ (FORT-0.2).
 *
 * Главное, что проверяется, — НЕ «возвращает true где надо», а то, что решение кнопки
 * СОВПАДАЕТ с правилом редьюсера. Расхождение этих двух и есть класс ошибки, ради
 * которого модуль существует (ORB-4), и заметить его тестом на одну сторону нельзя.
 */
import { describe, expect, it } from 'vitest';
import { forkFortressRaise, fortressRaise } from './fortressRaise';
import { createKernel, forkSiteId, parseGameData, STATION_COST } from '../packages/shared-core/src/index';
import { stationModule } from '../packages/shared-core/src/modules/station';
import { technologyModule } from '../packages/shared-core/src/modules/technology';
import { shippedGameData } from '../data/bundle';
import { createInitialState } from '../packages/shared-core/src/state/gameState';
import type { GameData, GameState, Planet } from '../packages/shared-core/src/index';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  // Ядро крепости обязано быть в каталоге: `station.deploy` ставит его сам и без него
  // отказывает (крепость вышла бы бестелесной). Каталог без ядра — не «другой баланс», а
  // сломанные данные, и держать на них паритет кнопки незачем: кнопка моделирует ПРАВИЛА
  // игры, а целостность каталога стережёт загрузчик.
  buildings: { starfort: { name: 'Void Fortress', hp: 70, onlyOn: [] } },
  events: {},
  sectorKinds: {
    asteroid: { capturable: true, buildable: true, orbit: false },
    nebula: { capturable: true, buildable: false, orbit: false },
    planet: { capturable: true, buildable: true, orbit: true, stationable: false },
    void_station: { capturable: true, buildable: true, orbit: true, stationable: false },
    empty: { capturable: false, buildable: false, orbit: false },
  },
});

const node = (kind: string, owner: string | null): Pick<Planet, 'kind' | 'owner'> => ({ kind, owner });
const rich = { metal: 500 };

describe('FORT-0.2 — кнопка крепости', () => {
  it('на своей местности кнопка ЕСТЬ и нажимается', () => {
    const d = fortressRaise(node('asteroid', 'p1'), 'p1', rich, data);
    expect(d.show).toBe(true);
    expect(d.enabled).toBe(true);
    expect(d.blocked).toBeNull();
  });

  it('на НЕЗАСТРАИВАЕМОЙ своей местности — тоже есть: крепость и есть способ её застроить', () => {
    expect(fortressRaise(node('nebula', 'p1'), 'p1', rich, data).show).toBe(true);
  });

  it('на планете и на готовой крепости кнопки НЕТ — это не место', () => {
    for (const kind of ['planet', 'void_station']) {
      const d = fortressRaise(node(kind, 'p1'), 'p1', rich, data);
      expect(d.show, kind).toBe(false);
      expect(d.blocked, kind).toBe('kind');
    }
  });

  it('на чужом и ничейном узле кнопки НЕТ', () => {
    expect(fortressRaise(node('asteroid', 'p2'), 'p1', rich, data).blocked).toBe('not-owned');
    expect(fortressRaise(node('empty', null), 'p1', rich, data).blocked).toBe('not-owned');
  });

  it('без денег кнопка ЕСТЬ, но не нажимается — это разные сообщения игроку', () => {
    const d = fortressRaise(node('asteroid', 'p1'), 'p1', { metal: 10 }, data);
    expect(d.show).toBe(true);
    expect(d.enabled).toBe(false);
    expect(d.blocked).toBe('cost');
  });

  it('цена берётся У ЯДРА, а не своей копией', () => {
    expect(fortressRaise(node('asteroid', 'p1'), 'p1', rich, data).cost).toBe(STATION_COST);
  });
});

describe('FORT-0.2 — кнопка и редьюсер решают ОДИНАКОВО', () => {
  // Тот самый тест, ради которого модуль и заведён: перебираем все расклады и требуем,
  // чтобы «кнопка нажимается» совпадало с «редьюсер принял» в каждом.
  const kernel = createKernel([stationModule]);

  function world(kind: string, owner: string | null, metal: number): GameState {
    const base = createInitialState({ seed: 'f', version: { data: '0.1.0', manifest: '1' } });
    return {
      ...base,
      players: { p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal } } },
      planets: {
        N: { id: 'N', owner, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [], kind },
      },
    };
  }

  it('ни одного расклада, где кнопка и ядро расходятся', () => {
    const cases: Array<[string, string | null, number]> = [];
    for (const kind of ['asteroid', 'nebula', 'planet', 'void_station', 'empty']) {
      for (const owner of ['p1', 'p2', null]) {
        for (const metal of [500, 10]) cases.push([kind, owner, metal]);
      }
    }
    for (const [kind, owner, metal] of cases) {
      const st = world(kind, owner, metal);
      const decision = fortressRaise(st.planets.N!, 'p1', st.players.p1!.resources, data);
      const r = kernel.applyAction(
        st,
        { id: 's:p1:1', type: 'station.deploy', playerId: 'p1', payload: { planetId: 'N' }, issuedAt: 0 },
        { now: 0, data },
      );
      expect(decision.enabled, `${kind}/${owner}/${metal}: кнопка и ядро разошлись`).toBe(r.ok);
    }
  });
});

describe('FORT-5.1 — крепость надо изучить (сообщение владельца 2026-09-24)', () => {
  // Настоящие данные: ядро `starfort` открывает «Укрепления Пустоты». Кнопка горела на
  // неизученной крепости, ядро отвечало `E_TECH_LOCKED`, игрок видел «нужна технология».
  const real = shippedGameData();
  const withTech = createKernel([stationModule, technologyModule]);
  const locks = fortressRaise({ kind: 'asteroid', owner: 'p1' }, 'p1', rich, real).needs;

  it('в данных крепость заперта технологией — кнопка её называет', () => {
    expect(locks.length).toBeGreaterThan(0);
    const d = fortressRaise({ kind: 'asteroid', owner: 'p1' }, 'p1', rich, real);
    expect(d).toMatchObject({ show: true, enabled: false, blocked: 'tech' });
    expect(fortressRaise({ kind: 'asteroid', owner: 'p1' }, 'p1', rich, real, [locks[0]!]).enabled).toBe(true);
  });

  it('без технологии и без денег — сперва технология: деньги её не заменят', () => {
    expect(fortressRaise({ kind: 'asteroid', owner: 'p1' }, 'p1', { metal: 0 }, real).blocked).toBe('tech');
  });

  it('кнопка и ядро С ТЕХНОЛОГИЯМИ решают одинаково во всех раскладах', () => {
    const kinds = Object.keys(real.sectorKinds ?? {});
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      for (const owner of ['p1', 'p2', null]) {
        for (const metal of [5000, 10]) {
          for (const completed of [[], [locks[0]!]]) {
            const base = createInitialState({ seed: 'f', version: { data: real.version, manifest: '1' } });
            const st: GameState = {
              ...base,
              players: {
                p1: {
                  id: 'p1',
                  name: 'p1',
                  faction: Object.keys(real.factions)[0]!,
                  status: 'active',
                  resources: { metal, credits: 5000 },
                  technologies: { completed: [...completed], active: [] },
                } as GameState['players'][string],
              },
              planets: {
                N: { id: 'N', owner, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [], kind },
              },
            };
            const decision = fortressRaise(st.planets.N!, 'p1', st.players.p1!.resources, real, completed);
            const r = withTech.applyAction(
              st,
              { id: 's:p1:1', type: 'station.deploy', playerId: 'p1', payload: { planetId: 'N' }, issuedAt: 0 },
              { now: 0, data: real },
            );
            const tag = `${kind}/${owner}/${metal}/${completed.join(',') || 'нет техн.'}`;
            expect(decision.enabled, `${tag}: кнопка и ядро разошлись`).toBe(r.ok);
          }
        }
      }
    }
  });
});

describe('FORT-6.1 — кнопка крепости на РАЗВИЛКЕ и редьюсер решают одинаково', () => {
  // Настоящие данные и дерево технологий: развилка — та же крепость, и ворота у неё те же.
  const real = shippedGameData();
  const withTech = createKernel([stationModule, technologyModule]);
  const locks = forkFortressRaise({ owner: 'p1' }, undefined, 'p1', rich, real).needs;
  const SITE = forkSiteId('B', 0);

  /** Провинция B с развилкой F на восточной тропе; площадка — если на развилке стояла крепость. */
  function world(owner: string | null, site: string | null | undefined, metal: number, completed: string[]): GameState {
    const base = createInitialState({ seed: 'ff', version: { data: real.version, manifest: '1' } });
    const bare = (id: string, x: number, y: number, links: string[], extra: Partial<Planet> = {}): Planet => ({
      id, owner: null, kind: 'planet', position: { x, y }, links, resources: {}, buildings: [], garrison: [], traits: [], ...extra,
    });
    const planets: Record<string, Planet> = {
      A: bare('A', 200, -150, ['B'], { roads: { crossings: { B: { x: 100, y: -75 } }, trails: [{ exits: ['B'], fork: null }] } }),
      C: bare('C', 200, 150, ['B'], { roads: { crossings: { B: { x: 100, y: 75 } }, trails: [{ exits: ['B'], fork: null }] } }),
      B: bare('B', 0, 0, ['A', 'C'], {
        owner,
        roads: {
          crossings: { A: { x: 100, y: -75 }, C: { x: 100, y: 75 } },
          trails: [{ exits: ['A', 'C'], fork: { x: 60, y: 0 } }],
        },
      }),
    };
    if (site !== undefined) {
      planets[SITE] = bare(SITE, 60, 0, [], { owner: site, kind: 'fork_station', fork: { province: 'B', trail: 0 } });
    }
    return {
      ...base,
      players: {
        p1: {
          id: 'p1', name: 'p1', faction: Object.keys(real.factions)[0]!, status: 'active',
          resources: { metal, credits: 5000 }, technologies: { completed: [...completed], active: [] },
        } as GameState['players'][string],
      },
      planets,
    };
  }

  it('своя провинция и свободная развилка — кнопка есть; занятая или чужая — нет', () => {
    const tech = [locks[0]!];
    expect(forkFortressRaise({ owner: 'p1' }, undefined, 'p1', rich, real, tech)).toMatchObject({ show: true, enabled: true });
    expect(forkFortressRaise({ owner: 'p1' }, { owner: null }, 'p1', rich, real, tech).enabled, 'пустая площадка').toBe(true);
    expect(forkFortressRaise({ owner: 'p1' }, { owner: 'p2' }, 'p1', rich, real, tech)).toMatchObject({ show: false, blocked: 'kind' });
    expect(forkFortressRaise({ owner: 'p2' }, undefined, 'p1', rich, real, tech)).toMatchObject({ show: false, blocked: 'not-owned' });
    expect(forkFortressRaise(undefined, undefined, 'p1', rich, real, tech).blocked).toBe('not-owned');
  });

  it('ни одного расклада, где кнопка и ядро расходятся', () => {
    for (const owner of ['p1', 'p2', null]) {
      for (const site of [undefined, null, 'p1', 'p2']) {
        for (const metal of [5000, 10]) {
          for (const completed of [[], [locks[0]!]]) {
            const st = world(owner, site, metal, completed);
            const decision = forkFortressRaise(st.planets.B, st.planets[SITE], 'p1', st.players.p1!.resources, real, completed);
            const r = withTech.applyAction(
              st,
              { id: 's:p1:1', type: 'station.deploy', playerId: 'p1', payload: { planetId: 'B', trail: 0 }, issuedAt: 0 },
              { now: 0, data: real },
            );
            const tag = `${owner}/${String(site)}/${metal}/${completed.join(',') || 'нет техн.'}`;
            expect(decision.enabled, `${tag}: кнопка и ядро разошлись`).toBe(r.ok);
          }
        }
      }
    }
  });
});

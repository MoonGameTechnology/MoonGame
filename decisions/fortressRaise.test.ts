/**
 * ПРИЁМКА РЕШЕНИЯ О КНОПКЕ КРЕПОСТИ (FORT-0.2).
 *
 * Главное, что проверяется, — НЕ «возвращает true где надо», а то, что решение кнопки
 * СОВПАДАЕТ с правилом редьюсера. Расхождение этих двух и есть класс ошибки, ради
 * которого модуль существует (ORB-4), и заметить его тестом на одну сторону нельзя.
 */
import { describe, expect, it } from 'vitest';
import { fortressRaise } from './fortressRaise';
import { createKernel, parseGameData, STATION_COST } from '../packages/shared-core/src/index';
import { stationModule } from '../packages/shared-core/src/modules/station';
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

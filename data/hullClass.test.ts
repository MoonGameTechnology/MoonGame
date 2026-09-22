/**
 * КЛАСС КОРПУСА И РАЗМЕР СТАПЕЛЯ (FORT-5.5 + FORT-5.6; решение владельца 15).
 *
 * «Верфь 1 уровня строит небольшие корабли» — а отличить небольшой от линкора было НЕЧЕМ:
 * у наземных есть род войск, у кораблей не было ничего. Поле `hullClass` и есть это
 * отличие, а третий уровень верфи — порог для тяжёлых.
 *
 * ГРАНИЦА ВЫБРАНА ТАК, ЧТОБЫ НЕ ПЕРЕПИСАТЬ ДЕБЮТ МОЛЧА. Сторож в `schemas.test.ts` прямо
 * предупреждает: «гейт на контент, который строится с первой минуты, меняет экономику
 * молча» — а дебют этой игры мерили девять кирпичей BAL. Поэтому родная верфь стартует
 * ВТОРЫМ уровнем: крейсер как строился с первой минуты, так и строится, а новым порогом
 * становится только тяжёлый корпус.
 */
import { describe, expect, it } from 'vitest';
import {
  buildingMaxLevel,
  constructionModule,
  createInitialState,
  createKernel,
  type Action,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([constructionModule]);

function world(yardLevel: number): GameState {
  const s = createInitialState({ seed: 'hc', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'x', status: 'active',
        resources: Object.fromEntries(data.resources.map((r) => [r, 99000])),
      },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'planet', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: 'shipyard', level: yardLevel, hp: 100 }],
        garrison: [], traits: [],
      },
    },
  };
}
const build = (unit: string): Action => ({
  id: 's:p1:1', type: 'unit.build', playerId: 'p1', payload: { planetId: 'A', unit }, issuedAt: 0,
});
const order = (yardLevel: number, unit: string): string | true => {
  const r = kernel.applyAction(world(yardLevel), build(unit), ctx());
  return r.ok ? true : r.code;
};
/** Класс каждого строящегося корабля каталога — по свойству, а не по списку имён. */
const shipsOf = (cls: string): string[] =>
  Object.entries(data.units)
    .filter(([, u]) => u.domain !== 'ground' && !u.traits.includes('shuttle') && u.hullClass === cls)
    .map(([id]) => id);

describe('класс корпуса — решение владельца 15', () => {
  it('у верфи ТРИ уровня, и каждый класс кораблей непуст', () => {
    expect(buildingMaxLevel(data.buildings.shipyard!)).toBe(3);
    for (const cls of ['light', 'medium', 'heavy']) {
      expect(shipsOf(cls).length, `класс ${cls} пуст — порог ни к чему не привязан`).toBeGreaterThan(0);
    }
  });

  it('стапель РАСТЁТ по классам: лёгкий с первого, средний со второго, тяжёлый с третьего', () => {
    for (const [cls, need] of [['light', 1], ['medium', 2], ['heavy', 3]] as const) {
      const ship = shipsOf(cls)[0]!;
      expect(order(need, ship), `${ship} (${cls}) не прошёл на верфи ${need}`).toBe(true);
      if (need > 1) {
        expect(order(need - 1, ship), `${ship} (${cls}) прошёл на МАЛОЙ верфи`).toBe('E_YARD_TOO_SMALL');
      }
    }
  });

  it('«верфи нет» и «верфь мала» — РАЗНЫЕ коды: первое лечится стройкой, второе прокачкой', () => {
    // Подменить их значило бы отправить игрока строить вторую верфь там, где нужна та
    // же, но выше.
    const heavy = shipsOf('heavy')[0]!;
    expect(order(1, heavy)).toBe('E_YARD_TOO_SMALL');
    const noYard: GameState = { ...world(1), planets: { A: { ...world(1).planets.A!, buildings: [] } } };
    const r = kernel.applyAction(noYard, build(heavy), ctx());
    expect(r.ok ? '' : r.code).toBe('E_NO_SHIPYARD');
  });

  it('стапель — МАКСИМУМ, а не сумма: две малых верфи линкор не соберут', () => {
    // Сегодня недостижимо (`maxPerPlanet` у верфи = 1), и именно поэтому проверка нужна:
    // без неё правило держится на одном комментарии и переживёт ровно до того дня, когда
    // лимит поднимут или второе здание научится закладывать корпуса.
    const medium = shipsOf('medium')[0]!;
    const base = world(1);
    const twoSmallYards: GameState = {
      ...base,
      planets: {
        A: {
          ...base.planets.A!,
          buildings: [
            { type: 'shipyard', level: 1, hp: 100 },
            { type: 'shipyard', level: 1, hp: 100 },
          ],
        },
      },
    };
    const r = kernel.applyAction(twoSmallYards, build(medium), ctx());
    expect(r.ok ? '' : r.code, 'два стапеля сложились в один большой').toBe('E_YARD_TOO_SMALL');
  });

  it('КЛАСС ОБЪЯВЛЕН У КАЖДОГО строящегося корабля — дефолт не подменяет данные', () => {
    // Тот же сторож, что у рода наземных войск: забытое поле молча сделало бы корпус
    // доступным с первого стапеля, и заметить это было бы нечем.
    const silent = Object.entries(data.units)
      .filter(([, u]) => u.domain !== 'ground' && !u.traits.includes('shuttle') && !u.traits.includes('issued'))
      .filter(([, u]) => u.hullClass === undefined)
      .map(([id]) => id);
    expect(silent.sort(), 'корабль без класса корпуса — заведите поле в data/units.json').toEqual([]);
  });
});

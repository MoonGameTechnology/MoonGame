// ORB-1 — ОРБИТАЛЬНОЕ ПКО ИСCЛЕДУЕТСЯ, А НЕ ВЫДАЁТСЯ.
//
// Заказ владельца звучал так: «изучается технология, строится здание». Не выполнялось
// НИ ОДНО из двух: батарея не значилась в `unlocks` ни одной технологии (гейт-механизм
// при этом работал — просто им никто не пользовался), а родной мир получал её готовой
// в `matchSetup.ts`. Получалось «выдаётся и строится ещё раз», а не «изучается».
//
// Файл проверяет весь путь игрока целиком, потому что каждая половина по отдельности
// бессмысленна: гейт при готовой постройке ничего не запирает, а снятие стартовой
// батареи без гейта просто отнимает оборону.
import { describe, expect, it } from 'vitest';
import { newGame, data, order, HOUR } from './game';
import { buildBuilding, researchTech } from './actions';
import type { GameState } from '../../packages/shared-core/src/index';

const ME = 'p1';
const TECH = 'orbital_defense_grid';
const AA = 'orbital_aa';

const myHome = (s: GameState) => Object.values(s.planets).find((p) => p.owner === ME)!;
/** Казна, которой хватит и на исследование, и на постройку. */
const rich = (s: GameState): GameState => ({
  ...s,
  players: {
    ...s.players,
    [ME]: { ...s.players[ME]!, resources: { metal: 9000, credits: 9000, microelectronics: 900 } },
  },
});

describe('ПКО: технология есть в каталоге и запирает именно батарею', () => {
  it('узел объявлен и открывает ровно orbital_aa', () => {
    expect(data.technologies[TECH]).toBeDefined();
    expect(data.technologies[TECH]?.unlocks.buildings).toEqual([AA]);
  });

  it('он ЯРУС 1 без предпосылок: оборону надо оплатить и подождать, а не заслужить цепочкой', () => {
    expect(data.technologies[TECH]?.tier).toBe(1);
    expect(data.technologies[TECH]?.prerequisites).toEqual([]);
    expect(data.technologies[TECH]?.researchTimeHours).toBeGreaterThan(0);
    expect(Object.keys(data.technologies[TECH]?.cost ?? {}).length).toBeGreaterThan(0);
  });
});

describe('ПКО: путь игрока', () => {
  it('СТАРТОВОЙ БАТАРЕИ НЕТ НИ У КОГО — иначе «изучается» не значит ничего', () => {
    const s = newGame();
    for (const p of Object.values(s.planets)) {
      expect(
        p.buildings.map((b) => b.type),
        p.id,
      ).not.toContain(AA);
    }
  });

  it('до исследования постройка отбивается E_TECH_LOCKED', () => {
    const s = rich(newGame());
    expect(order(s, buildBuilding(ME, myHome(s).id, AA), s.time).error).toBe('E_TECH_LOCKED');
  });

  it('ПОСЛЕ исследования — та же постройка проходит', () => {
    let s = rich(newGame());
    const started = order(s, researchTech(ME, TECH), s.time);
    expect(started.error).toBeUndefined();
    s = started.state;
    // Доводим исследование до конца: время идёт внутри `order`, поэтому просто
    // отдаём следующий приказ позже срока (`researchTimeHours` = 5).
    const built = order(s, buildBuilding(ME, myHome(s).id, AA), s.time + 24 * HOUR);
    expect(built.error).toBeUndefined();
  });
});

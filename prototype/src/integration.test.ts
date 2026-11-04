import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, netIncome, advance, HOUR } from './game';
import { resourceCardHtml } from './resourceCard';
import { data } from './gameData';
import { openTurn } from './aiTurn/turn';
import {
  INTEGRATION_HOURS,
  isInhabited,
  type GameState,
} from '../../packages/shared-core/src/index';

beforeAll(() => setLocale('ru'));

/** p1's home and a planet it took from p2 a moment ago, integrating from `s.time`. */
function takenWorld(): { s: GameState; home: string; taken: string } {
  const s = newGame();
  const home = Object.values(s.planets).find((p) => p.owner === 'p1' && isInhabited(data, p))!.id;
  const taken = Object.values(s.planets).find((p) => p.owner === null && isInhabited(data, p))!;
  taken.owner = 'p1';
  taken.garrison = []; // keep the HUD/settlement comparison free of militia upkeep noise
  taken.integration = { claim: 'p2', since: s.time, until: s.time + INTEGRATION_HOURS * HOUR };
  return { s, home, taken: taken.id };
}

describe('освоение в прототипе (BAL-19)', () => {
  it('HUD показывает тот же приток, что начисляет ядро, у державы с осваиваемой планетой', () => {
    const { s } = takenWorld();
    // Без освоения тот же HUD показывает доход выше.
    const full = structuredClone(s);
    for (const p of Object.values(full.planets)) delete p.integration;
    expect(netIncome(full, 'p1').metal ?? 0).toBeGreaterThan(netIncome(s, 'p1').metal ?? 0);
    // HUD читает долю в миг состояния, ядро начисляет её среднее за отрезок: у линейного
    // подъёма за час это доля в середине часа.
    const mid = { ...s, time: s.time + HOUR / 2 };
    const after = advance(s, s.time + HOUR).state;
    for (const res of ['metal', 'credits']) {
      const rate = netIncome(mid, 'p1')[res] ?? 0;
      const gained = (after.players.p1!.resources[res] ?? 0) - (s.players.p1!.resources[res] ?? 0);
      expect(rate, res).toBeGreaterThan(0);
      expect(gained, res).toBeCloseTo(rate, 3);
    }
  });

  it('карточка ресурса называет осваиваемые планеты и молчит без них', () => {
    const { s } = takenWorld();
    expect(resourceCardHtml(s, 'p1', 'metal', {}, false)).toContain(
      'В освоении 1 планета: доход с них от 25% до 100%',
    );
    for (const p of Object.values(s.planets)) delete p.integration;
    expect(resourceCardHtml(s, 'p1', 'metal', {}, false)).not.toContain('В освоении');
  });

  it('бот не держит базу на осваиваемой планете и не заказывает там юниты', () => {
    const { s, home, taken } = takenWorld();
    const yard = (type: string): boolean => data.buildings[type]?.enablesShipConstruction === true;
    for (const p of Object.values(s.planets))
      if (p.owner === 'p1') p.buildings = p.buildings.filter((b) => !yard(b.type));
    const shipyard = Object.keys(data.buildings).find(yard)!;
    s.planets[taken]!.buildings.push({ type: shipyard, level: 1, hp: 50 });
    const turn = openTurn(s, 'p1', 'expand', 'strong', new Set());
    expect(turn?.outside.has(taken)).toBe(true);
    expect(turn?.base?.id).toBe(home);
  });
});

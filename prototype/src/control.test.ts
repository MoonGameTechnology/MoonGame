import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, netIncome, advance, HOUR } from './game';
import { resourceCardHtml } from './resourceCard';
import { data } from './gameData';
import {
  CONTROL_LIMIT,
  isInhabited,
  uncontrolledPlanets,
  type GameState,
} from '../../packages/shared-core/src/index';

beforeAll(() => setLocale('ru'));

/** p1 holds exactly `n` planets: its own plus unowned ones handed over. */
function empireOf(n: number): GameState {
  const s = newGame();
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
});

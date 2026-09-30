import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, netIncome, advance, HOUR } from './game';
import { resourceCardHtml } from './resourceCard';
import { SPRAWL_FREE, type GameState } from '../../packages/shared-core/src/index';

beforeAll(() => setLocale('ru'));

/** p1 holds exactly `n` provinces: its own plus unowned ones handed over. */
function empireOf(n: number): GameState {
  const s = newGame();
  let owned = Object.values(s.planets).filter((p) => p.owner === 'p1').length;
  for (const p of Object.values(s.planets)) {
    if (owned >= n) break;
    if (p.owner !== null) continue;
    p.owner = 'p1';
    p.garrison = []; // keep the HUD/settlement comparison free of militia upkeep noise
    owned += 1;
  }
  expect(owned).toBe(n);
  return s;
}

describe('налог на рост державы в прототипе (BAL-10)', () => {
  it('HUD показывает тот же приток, что начисляет ядро, и у большой державы', () => {
    const s = empireOf(SPRAWL_FREE + 5);
    const after = advance(s, s.time + HOUR).state;
    // Кредиты — вместе с гражданским налогом, который налог на рост тоже режет.
    for (const res of ['metal', 'credits']) {
      const rate = netIncome(s, 'p1')[res] ?? 0;
      const gained = (after.players.p1!.resources[res] ?? 0) - (s.players.p1!.resources[res] ?? 0);
      expect(rate, res).toBeGreaterThan(0);
      expect(gained, res).toBeCloseTo(rate, 3);
    }
  });

  it('карточка ресурса объясняет налог тому, кто его платит, и молчит у малой державы', () => {
    const big = empireOf(SPRAWL_FREE + 5);
    expect(resourceCardHtml(big, 'p1', 'metal', {}, false)).toContain(
      `Налог на рост: −33% (${SPRAWL_FREE + 5} провинций, без налога до ${SPRAWL_FREE})`,
    );
    const small = empireOf(SPRAWL_FREE);
    expect(resourceCardHtml(small, 'p1', 'metal', {}, false)).not.toContain('Налог на рост');
  });
});

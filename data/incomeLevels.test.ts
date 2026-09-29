/**
 * УРОВНИ НАЛОГОВОЙ И КРЕДИТНОГО НПЗ (решение владельца 2026-09-26: «дать уровни налоговой и
 * здания, которое даёт деньги»). Резолюция — «как у шахты, ×1,5»: три уровня, налоговая
 * +25 → +35 → +50% ко всему кредитному доходу мира, НПЗ 8 → 12 → 18 кредитов в час; цена
 * улучшения, срок и содержание растут, как у шахты и фермы. Улучшения НПЗ окупаются не дольше
 * улучшений шахты (решение владельца 2026-09-29: «НПЗ — удешеви улучшения»).
 *
 * Сторожим по шипнутым данным и через настоящие приказ и ход часов: уровень существует,
 * только если его можно купить и если он меняет доход.
 */
import { describe, expect, it } from 'vitest';
import {
  buildingLevel,
  buildingMaxLevel,
  civicTax,
  constructionModule,
  createInitialState,
  createKernel,
  economyModule,
  taxModule,
  type Action,
  type BuildingDef,
  type Context,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });
const refinery = data.buildings.refinery!;
const taxOffice = data.buildings.tax_office!;

function world(buildings: Planet['buildings']): GameState {
  const s = createInitialState({ seed: 'income', version: { data: data.version, manifest: '1' } });
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
        resources: {}, buildings, garrison: [], traits: [],
      },
    },
  };
}

describe('уровни дохода: налоговая и НПЗ — как у шахты, ×1,5', () => {
  it('три уровня: НПЗ 8/12/18 кредитов в час, налоговая +25/+35/+50%', () => {
    expect(buildingMaxLevel(refinery)).toBe(buildingMaxLevel(data.buildings.mine!));
    expect(buildingMaxLevel(taxOffice)).toBe(3);
    expect([1, 2, 3].map((l) => buildingLevel(refinery, l).produces.credits)).toEqual([8, 12, 18]);
    expect([1, 2, 3].map((l) => buildingLevel(taxOffice, l).creditsBonus)).toEqual([0.25, 0.35, 0.5]);
  });

  it('улучшение дороже, дольше и прочнее предыдущего уровня; содержание НПЗ растёт, как у фермы', () => {
    for (const def of [refinery, taxOffice]) {
      for (const l of [2, 3]) {
        const [prev, next] = [buildingLevel(def, l - 1), buildingLevel(def, l)];
        expect(next.cost.metal!, `${def.name} ${l}`).toBeGreaterThan(prev.cost.metal!);
        expect(next.buildTimeHours).toBeGreaterThan(prev.buildTimeHours);
        expect(next.hp).toBeGreaterThan(prev.hp);
      }
    }
    // Ферма: 30 → 50 → 80 энергии (×5/3, ×8/3). У НПЗ та же доля от его 40.
    const farm = [1, 2, 3].map((l) => buildingLevel(data.buildings.farm!, l).upkeep.energy!);
    const own = [1, 2, 3].map((l) => buildingLevel(refinery, l).upkeep.energy!);
    for (const l of [1, 2]) expect(own[l]! / own[0]!).toBeCloseTo(farm[l]! / farm[0]!, 0);
  });

  it('улучшение НПЗ окупается не дольше улучшения шахты', () => {
    // Окупаемость — цена улучшения (металл + кредиты) на прирост выхода в час, как в таблице
    // `docs/resource-economy.md` §4. Прежние цены НПЗ окупались за ~58 и ~68 ч против ~23 и
    // ~31 ч у шахты — владелец решил удешевить (2026-09-29).
    const payback = (def: BuildingDef, level: number, res: string): number => {
      const { cost } = buildingLevel(def, level);
      const gain =
        (buildingLevel(def, level).produces[res] ?? 0) - (buildingLevel(def, level - 1).produces[res] ?? 0);
      return ((cost.metal ?? 0) + (cost.credits ?? 0)) / gain;
    };
    const mine = data.buildings.mine!;
    const slowestMine = Math.max(payback(mine, 2, 'metal'), payback(mine, 3, 'metal'));
    for (const l of [2, 3]) {
      expect(payback(refinery, l, 'credits'), `НПЗ ${l}`).toBeLessThanOrEqual(slowestMine);
    }
  });

  it('уровни покупаются обычным `building.upgrade`, четвёртого нет', () => {
    const kernel = createKernel([constructionModule]);
    const upgrade = (s: GameState, building: string, n: number): { state: GameState } | string => {
      const action: Action = {
        id: `u:${building}:${n}`, type: 'building.upgrade', playerId: 'p1', issuedAt: s.time,
        payload: { planetId: 'A', building },
      };
      const r = kernel.applyAction(s, action, ctx(s.time));
      if (!r.ok) return r.code;
      const done = kernel.advanceTo(r.state, ctx(s.time + 10 * HOUR));
      if (!done.ok) return done.code;
      return { state: done.state };
    };
    let s = world([
      { type: 'refinery', level: 1, hp: refinery.hp },
      { type: 'tax_office', level: 1, hp: taxOffice.hp },
    ]);
    for (const building of ['refinery', 'tax_office']) {
      for (const n of [2, 3]) {
        const r = upgrade(s, building, n);
        if (typeof r === 'string') throw new Error(`${building} → ${n}: ${r}`);
        s = r.state;
        expect(s.planets.A!.buildings.find((b) => b.type === building)?.level).toBe(n);
      }
      expect(upgrade(s, building, 4)).toBe('E_MAX_LEVEL');
    }
  });

  it('уровень меняет доход мира: НПЗ и налоговая третьего уровня — (18 + налог) × 1,5 в час', () => {
    const kernel = createKernel([constructionModule, taxModule, economyModule]);
    const income = (level: number): number => {
      const s = world([
        { type: 'refinery', level, hp: buildingLevel(refinery, level).hp },
        { type: 'tax_office', level, hp: buildingLevel(taxOffice, level).hp },
      ]);
      const r = kernel.advanceTo(s, ctx(HOUR));
      if (!r.ok) throw new Error(r.code);
      return r.state.players.p1!.resources.credits! - s.players.p1!.resources.credits!;
    };
    expect(income(1)).toBeCloseTo((8 + civicTax(1)) * 1.25);
    expect(income(2)).toBeCloseTo((12 + civicTax(1)) * 1.35);
    expect(income(3)).toBeCloseTo((18 + civicTax(1)) * 1.5);
  });
});

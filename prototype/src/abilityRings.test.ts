import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { abilityRings, type RingAnchors } from './abilityRings';
import type { GameState } from '../../packages/shared-core/src/index';

const HERO_AT = { x: 10, y: 20 };
const NODE_AT = { x: 100, y: 200 };

const anchors: RingAnchors = {
  hero: () => ({ ...HERO_AT }),
  node: (id) => (id === 'P1' ? { ...NODE_AT } : null),
};

/** Состояние с одним моим развёрнутым героем; эффекты подставляются тестом. */
function withHero(over: Record<string, unknown> = {}, owner = 'p1'): Pick<GameState, 'heroes'> {
  return {
    heroes: {
      h1: { id: 'h1', owner, alive: true, fleetId: 'f1', ...over },
    },
  } as unknown as Pick<GameState, 'heroes'>;
}

describe('радиусы способностей — что попадает на карту', () => {
  it('без героев и без эффектов кругов нет', () => {
    expect(abilityRings({ heroes: undefined }, 'p1', 0, anchors)).toEqual([]);
    expect(abilityRings(withHero(), 'p1', 0, anchors)).toEqual([]);
  });

  it('живая аура рисуется ПО ГЕРОЮ — она ходит за ним, а не за местом каста', () => {
    const s = withHero({ activeAuras: [{ bonus: 0.1, radius: 300, until: 500 }] });
    expect(abilityRings(s, 'p1', 100, anchors)).toEqual([
      { x: HERO_AT.x, y: HERO_AT.y, radius: 300, kind: 'aura' },
    ]);
  });

  it('скан прибит к своему узлу, а не к герою', () => {
    const s = withHero({ activeReveals: [{ center: 'P1', radius: 250, until: 500 }] });
    expect(abilityRings(s, 'p1', 100, anchors)).toEqual([
      { x: NODE_AT.x, y: NODE_AT.y, radius: 250, kind: 'reveal' },
    ]);
  });

  it('просроченный эффект гаснет в тот же кадр (сравнение по ИГРОВОМУ времени)', () => {
    const s = withHero({
      activeAuras: [{ bonus: 0.1, radius: 300, until: 500 }],
      activeReveals: [{ center: 'P1', radius: 250, until: 500 }],
    });
    expect(abilityRings(s, 'p1', 499, anchors)).toHaveLength(2);
    expect(abilityRings(s, 'p1', 500, anchors)).toEqual([]); // ровно на сроке — уже нет
  });

  it('ЧУЖИЕ и мёртвые не рисуются — своих эффектов врага игрок не знает', () => {
    const aura = { activeAuras: [{ bonus: 0.1, radius: 300, until: 500 }] };
    expect(abilityRings(withHero(aura, 'p2'), 'p1', 100, anchors)).toEqual([]);
    expect(abilityRings(withHero({ ...aura, alive: false }), 'p1', 100, anchors)).toEqual([]);
    // герой в резерве (`alive` не выставлен) тоже молчит — он не на карте
    expect(abilityRings(withHero({ ...aura, alive: undefined }), 'p1', 100, anchors)).toEqual([]);
  });

  it('нулевой радиус и неизвестный узел круга не дают', () => {
    expect(
      abilityRings(withHero({ activeAuras: [{ bonus: 0.1, radius: 0, until: 500 }] }), 'p1', 0, anchors),
    ).toEqual([]);
    expect(
      abilityRings(
        withHero({ activeReveals: [{ center: 'НЕТ', radius: 250, until: 500 }] }),
        'p1',
        0,
        anchors,
      ),
    ).toEqual([]);
  });

  it('герой без корабля круга не даёт, даже если аура живая', () => {
    const blind: RingAnchors = { hero: () => null, node: () => null };
    const s = withHero({ activeAuras: [{ bonus: 0.1, radius: 300, until: 500 }] });
    expect(abilityRings(s, 'p1', 100, blind)).toEqual([]);
  });

  it('порядок детерминирован — кадр не мерцает при перерисовке', () => {
    const s = {
      heroes: {
        h2: { id: 'h2', owner: 'p1', alive: true, activeAuras: [{ bonus: 1, radius: 2, until: 9 }] },
        h1: { id: 'h1', owner: 'p1', alive: true, activeAuras: [{ bonus: 1, radius: 1, until: 9 }] },
      },
    } as unknown as Pick<GameState, 'heroes'>;
    expect(abilityRings(s, 'p1', 0, anchors).map((r) => r.radius)).toEqual([1, 2]);
  });
});

// Проводка живёт в main.ts без юнит-обвязки — сканом исходника, как в cmdVisibility.test.ts.
describe('радиусы способностей — подключение к main.ts', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('цвет один и он фиолетовый, а линия — пунктир', () => {
    expect(src).toMatch(/const ABILITY_RING = '#b78cff';/);
    const at = src.indexOf('function drawAbilityCircle');
    const body = src.slice(at, at + 600);
    expect(body).toContain('setLineDash([7, 6])');
    expect(body).toContain('rgba(ABILITY_RING');
  });

  it('и прицел, и живые эффекты идут через ОДНУ рисовалку — двух видов радиуса нет', () => {
    expect(src).toContain('if (aoe > 0) drawAbilityCircle(');
    expect(src).toContain('for (const r of rings) drawAbilityCircle(');
    expect(src).not.toContain('CAST_AREA'); // прежний сплошной голубой круг убран целиком
  });

  it('кадр рисует живые круги', () => {
    expect(src).toContain('drawAbilityRings();');
  });
});

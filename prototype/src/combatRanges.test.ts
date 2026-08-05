// RANGE-UX — сторож «круг = то, по чему ядро стреляет».
//
// Смысл файла не в том, что круги рисуются, а в том, что их РАДИУС берётся из ядра.
// Заведи кто-нибудь свою формулу в клиенте — и игрок целится по одному кругу, а огонь
// идёт по другому; поймать это глазами нельзя, а тестом — можно.
import { describe, it, expect } from 'vitest';
import { artilleryRange, squadronStrikeRange } from '../../packages/shared-core/src/index';
import { newGame, data } from './game';
import { combatRanges } from './combatRanges';
import type { Fleet, GameState } from '../../packages/shared-core/src/index';

const ME = 'p1';
const HERE = { x: 0, y: 0 };
const locate = () => HERE;
const seen = () => true;

/** Партия, в которой мой флот несёт заданный набор кораблей. */
function withFleet(units: Array<{ unit: string; count: number }>): {
  s: GameState;
  fleet: Fleet;
} {
  const base = newGame();
  const mine = Object.values(base.fleets).find((f) => f.owner === ME);
  if (!mine) throw new Error('в стартовой партии нет моего флота');
  const fleet: Fleet = { ...mine, units };
  return { s: { ...base, fleets: { ...base.fleets, [fleet.id]: fleet } }, fleet };
}

describe('RANGE-UX — радиусы приходят из ядра, а не из интерфейса', () => {
  it('круг артиллерии равен artilleryRange ядра — до последней единицы', () => {
    const { s, fleet } = withFleet([{ unit: 'siege', count: 2 }]);
    const ring = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.find(
      (r) => r.kind === 'artillery',
    );
    expect(ring).toBeDefined();
    expect(ring!.radius).toBe(artilleryRange(fleet, data));
    expect(ring!.radius).toBeGreaterThan(0);
  });

  it('круг эскадрильи равен squadronStrikeRange ядра', () => {
    const { s, fleet } = withFleet([
      { unit: 'fighter_squadron', count: 2 },
      { unit: 'strike_carrier', count: 1 },
    ]);
    const core = squadronStrikeRange(fleet, data);
    const ring = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.find(
      (r) => r.kind === 'squadron',
    );
    // Радиус крыла даёт НОСИТЕЛЬ, а не сама эскадрилья (в форк-каталоге прототипа у
    // `fighter_squadron` strikeRange = 0). Сторож держит равенство с ядром в любом
    // случае: есть радиус — есть круг, нет радиуса — нет круга.
    if (core > 0) {
      expect(ring).toBeDefined();
      expect(ring!.radius).toBe(core);
    } else {
      expect(ring).toBeUndefined();
    }
  });

  it('флот без пушек и без крыла кругов не даёт — пустой оверлей, а не нулевой радиус', () => {
    const { s, fleet } = withFleet([{ unit: 'cruiser', count: 3 }]);
    const rings = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.filter(
      (r) => r.sourceId === fleet.id,
    );
    expect(rings).toEqual([]);
  });

  it('линия огня рисуется ТОЛЬКО когда цель существует', () => {
    const { s, fleet } = withFleet([{ unit: 'siege', count: 1 }]);
    // цель есть
    const foe = Object.values(s.fleets).find((f) => f.id !== fleet.id);
    if (foe) {
      const armed: Fleet = { ...fleet, barrageTarget: foe.id };
      const withTarget = { ...s, fleets: { ...s.fleets, [armed.id]: armed } };
      expect(combatRanges(withTarget, data, [armed.id], ME, locate, seen).lines).toHaveLength(1);
    }
    // цель погибла — круг остаётся, линии нет (врать про несуществующую цель нельзя)
    const ghost: Fleet = { ...fleet, barrageTarget: 'нет-такого-флота' };
    const stale = { ...s, fleets: { ...s.fleets, [ghost.id]: ghost } };
    const out = combatRanges(stale, data, [ghost.id], ME, locate, seen);
    expect(out.lines).toEqual([]);
    expect(out.rings.some((r) => r.kind === 'artillery')).toBe(true);
  });
});

describe('RANGE-UX — ПВО: отметка, а не область; и оно под туманом', () => {
  it('у ПВО радиус НОЛЬ — оно бьёт по своему узлу, круга у него нет', () => {
    const s = newGame();
    const aa = combatRanges(s, data, [], ME, locate, seen).rings.filter((r) => r.kind === 'aa');
    expect(aa.length).toBeGreaterThan(0); // стартовый мир несёт orbital_aa
    for (const r of aa) expect(r.radius).toBe(0);
  });

  it('чужие зубы ПВО не показываются за туманом — оверлей не должен быть разведкой', () => {
    const s = newGame();
    const visible = combatRanges(s, data, [], ME, locate, seen).rings.filter((r) => r.kind === 'aa');
    const fogged = combatRanges(s, data, [], ME, locate, () => false).rings.filter(
      (r) => r.kind === 'aa',
    );
    // под полным туманом остаются ТОЛЬКО свои миры
    expect(fogged.length).toBeLessThan(visible.length);
    for (const r of fogged) expect(s.planets[r.sourceId]?.owner).toBe(ME);
  });
});

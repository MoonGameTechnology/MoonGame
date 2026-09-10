// RANGE-UX — сторож «круг = то, по чему ядро стреляет».
//
// Смысл файла не в том, что круги рисуются, а в том, что их РАДИУС берётся из ядра.
// Заведи кто-нибудь свою формулу в клиенте — и игрок целится по одному кругу, а огонь
// идёт по другому; поймать это глазами нельзя, а тестом — можно.
import { describe, it, expect } from 'vitest';
import { shuttleStrikeRange } from '../../packages/shared-core/src/index';
import { newGame, data } from './game';
import { aimRing, combatRanges, ringLook, type RangeKind } from './combatRanges';
import { squadronReach } from '../../packages/shared-core/src/index';
import type { Squadron } from '../../packages/shared-core/src/index';
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
  it('круг эскадрильи равен shuttleStrikeRange ядра', () => {
    const { s, fleet } = withFleet([
      { unit: 'interceptor', count: 2 },
      { unit: 'strike_carrier', count: 1 },
    ]);
    const core = shuttleStrikeRange(fleet, data);
    const ring = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.find(
      (r) => r.kind === 'shuttle',
    );
    // Радиус крыла даёт НОСИТЕЛЬ, а не сама эскадрилья (в форк-каталоге прототипа у
    // `interceptor` strikeRange = 0). Сторож держит равенство с ядром в любом
    // случае: есть радиус — есть круг, нет радиуса — нет круга.
    if (core > 0) {
      expect(ring).toBeDefined();
      expect(ring!.radius).toBe(core);
    } else {
      expect(ring).toBeUndefined();
    }
  });

  it('флот без крыла кругов не даёт — пустой оверлей, а не нулевой радиус', () => {
    const { s, fleet } = withFleet([{ unit: 'cruiser', count: 3 }]);
    const rings = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.filter(
      (r) => r.sourceId === fleet.id,
    );
    expect(rings).toEqual([]);
  });
});

/** Партия, в которой КАЖДЫЙ владеемый мир поднял орбитальное ПКО.
 *
 *  ORB-1: стартовое ПКО отобрано — теперь батарея исследуется (`orbital_defense_grid`)
 *  и строится. Тесты ниже про ПРАВИЛА ОВЕРЛЕЯ (радиус, туман), а не про стартовую
 *  раскладку, поэтому батарею они ставят себе сами. */
function withAa(): GameState {
  const base = newGame();
  const planets = { ...base.planets };
  for (const p of Object.values(planets)) {
    if (p.owner === null) continue;
    planets[p.id] = {
      ...p,
      buildings: [...p.buildings, { type: 'orbital_aa', level: 1, hp: 30 }],
    };
  }
  return { ...base, planets };
}

describe('RANGE-UX — ПВО: отметка, а не область; и оно под туманом', () => {
  it('у ПВО радиус НОЛЬ — оно бьёт по своему узлу, круга у него нет', () => {
    const s = withAa();
    const aa = combatRanges(s, data, [], ME, locate, seen).rings.filter((r) => r.kind === 'aa');
    expect(aa.length).toBeGreaterThan(0);
    for (const r of aa) expect(r.radius).toBe(0);
  });

  it('чужие зубы ПВО не показываются за туманом — оверлей не должен быть разведкой', () => {
    const s = withAa();
    const visible = combatRanges(s, data, [], ME, locate, seen).rings.filter((r) => r.kind === 'aa');
    const fogged = combatRanges(s, data, [], ME, locate, () => false).rings.filter(
      (r) => r.kind === 'aa',
    );
    // под полным туманом остаются ТОЛЬКО свои миры
    expect(fogged.length).toBeLessThan(visible.length);
    for (const r of fogged) expect(s.planets[r.sourceId]?.owner).toBe(ME);
  });
});

describe('RANGE-UX — заметность кольца (REFM-123)', () => {
  it('ПВО ЗАМЕТНЕЕ РАДИУСА ВЫЛЕТА: это отметка на мире, и утонуть в фоне ей нельзя', () => {
    expect(ringLook('aa').alpha).toBeGreaterThan(ringLook('shuttle').alpha);
  });

  it('у ПВО СВОЙ пунктир — отметка не должна читаться как обрезанный радиус', () => {
    expect(ringLook('aa').dash).not.toEqual(ringLook('shuttle').dash);
  });

  it('оба вида рисуются видимой линией', () => {
    for (const kind of ['shuttle', 'aa'] as RangeKind[]) {
      const look = ringLook(kind);
      expect(look.alpha).toBeGreaterThan(0);
      expect(look.width).toBeGreaterThan(0);
      expect(look.dash[0]).toBeGreaterThan(0);
      expect(look.dash[1]).toBeGreaterThan(0);
    }
  });

  it('вид стабилен', () => {
    expect(ringLook('shuttle')).toEqual(ringLook('shuttle'));
  });
});

describe('SHU-3.1 — круг ВЗВЕДЁННОГО прицела', () => {
  const squad = (units: Array<[string, number]>): Squadron => ({
    id: 'sq:p1:1',
    units: units.map(([unit, count]) => ({ unit, count })),
  });

  it('РАДИУС РАВЕН squadronReach ЯДРА — тому самому, по которому оно отбивает промах', () => {
    const sq = squad([['landing_shuttle', 2]]);
    const core = squadronReach(sq, data);
    const ring = aimRing({ squadron: sq, at: { x: 7, y: 9 } }, data);
    if (core > 0) {
      expect(ring?.radius).toBe(core);
      expect(ring?.x).toBe(7);
      expect(ring?.y).toBe(9);
      expect(ring?.sourceId).toBe('sq:p1:1');
    } else {
      expect(ring).toBeNull();
    }
  });

  it('ДАЛЬНОСТЬ ПО САМОЙ КОРОТКОЙ РУКЕ, а не по самой длинной: круг обещает то, что долетит', () => {
    const mixed = squad([
      ['landing_shuttle', 1],
      ['interceptor', 1],
    ]);
    expect(aimRing({ squadron: mixed, at: { x: 0, y: 0 } }, data)?.radius ?? 0).toBe(
      squadronReach(mixed, data),
    );
  });

  it('ПРИЦЕЛ НЕ ВЗВЕДЁН — КРУГА НЕТ: кольцо показывает режим, а не свойство базы', () => {
    expect(aimRing(null, data)).toBeNull();
  });

  it('ЗВЕНО БЕЗ ДАЛЬНОСТИ КРУГА НЕ ДАЁТ — нулевой радиус не факт о мире, а линия ни о чём', () => {
    expect(aimRing({ squadron: squad([['militia', 3]]), at: { x: 0, y: 0 } }, data)).toBeNull();
  });

  it('ВЗВЕДЁННЫЙ ПРИЦЕЛ ЗАМЕТНЕЕ пассивного радиуса — по нему целятся прямо сейчас', () => {
    expect(ringLook('aim').alpha).toBeGreaterThan(ringLook('shuttle').alpha);
  });
});

// RANGE-UX — сторож «круг = то, по чему ядро стреляет».
//
// Смысл файла не в том, что круги рисуются, а в том, что их РАДИУС берётся из ядра.
// Заведи кто-нибудь свою формулу в клиенте — и игрок целится по одному кругу, а огонь
// идёт по другому; поймать это глазами нельзя, а тестом — можно.
import { describe, it, expect } from 'vitest';
import { artilleryRange, shuttleStrikeRange } from '../../packages/shared-core/src/index';
import { newGame, data } from './game';
import { combatRanges, ringLook, type RangeKind } from './combatRanges';
import type { Fleet, GameData, GameState } from '../../packages/shared-core/src/index';

const ME = 'p1';
const HERE = { x: 0, y: 0 };
const locate = () => HERE;
const seen = () => true;

/** Каталог с ДАЛЬНОБОЙНЫМ корпусом. После ROS-2.1 в живом ростере таких нет —
 *  артиллерия дерётся вплотную, — но механизм дальнего огня в движке остался и ждёт
 *  своего носителя (`missiles-roadmap.md`). Сторож проверяет МЕХАНИЗМ, поэтому носитель
 *  ему нужен свой; отдельный тест ниже следит, что в живом каталоге его действительно нет.
 */
const rangedData: GameData = {
  ...data,
  units: {
    ...data.units,
    longbow: {
      ...data.units.artillery!,
      stats: { ...data.units.artillery!.stats, range: 300 },
    },
  },
};

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
  it('круг дальнего огня равен artilleryRange ядра — до последней единицы', () => {
    const { s, fleet } = withFleet([{ unit: 'longbow', count: 2 }]);
    const ring = combatRanges(s, rangedData, [fleet.id], ME, locate, seen).rings.find(
      (r) => r.kind === 'artillery',
    );
    expect(ring).toBeDefined();
    expect(ring!.radius).toBe(artilleryRange(fleet, rangedData));
    expect(ring!.radius).toBeGreaterThan(0);
  });

  it('ROS-2.1: в ЖИВОМ каталоге дальнобойных корпусов не осталось — кругов не будет', () => {
    // Артиллерия подходит вплотную и вяжется в бой, поэтому радиуса у неё нет; движок
    // дальнего огня при этом жив и ждёт носителя (см. `rangedData` выше).
    const ranged = Object.entries(data.units)
      .filter(([, u]) => (u.stats.range ?? 0) > 0)
      .map(([id]) => id);
    expect(ranged).toEqual([]);
    const { s, fleet } = withFleet([{ unit: 'artillery', count: 2 }]);
    const rings = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.filter(
      (r) => r.kind === 'artillery',
    );
    expect(rings).toEqual([]);
  });

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

  it('флот без пушек и без крыла кругов не даёт — пустой оверлей, а не нулевой радиус', () => {
    const { s, fleet } = withFleet([{ unit: 'cruiser', count: 3 }]);
    const rings = combatRanges(s, data, [fleet.id], ME, locate, seen).rings.filter(
      (r) => r.sourceId === fleet.id,
    );
    expect(rings).toEqual([]);
  });

  it('линия огня рисуется ТОЛЬКО когда цель существует', () => {
    const { s, fleet } = withFleet([{ unit: 'longbow', count: 1 }]);
    // цель есть
    const foe = Object.values(s.fleets).find((f) => f.id !== fleet.id);
    if (foe) {
      const armed: Fleet = { ...fleet, barrageTarget: foe.id };
      const withTarget = { ...s, fleets: { ...s.fleets, [armed.id]: armed } };
      expect(combatRanges(withTarget, rangedData, [armed.id], ME, locate, seen).lines).toHaveLength(
        1,
      );
    }
    // цель погибла — круг остаётся, линии нет (врать про несуществующую цель нельзя)
    const ghost: Fleet = { ...fleet, barrageTarget: 'нет-такого-флота' };
    const stale = { ...s, fleets: { ...s.fleets, [ghost.id]: ghost } };
    const out = combatRanges(stale, rangedData, [ghost.id], ME, locate, seen);
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

describe('RANGE-UX — заметность кольца (REFM-123)', () => {
  it('ВЗВЕДЁННЫЙ ОБСТРЕЛ ДЕЛАЕТ ГРАНИЦУ ЯРЧЕ: пока целятся, «дострелю или нет» — главный вопрос', () => {
    expect(ringLook('artillery', true).alpha).toBeGreaterThan(ringLook('artillery', false).alpha);
  });

  it('в покое кольцо артиллерии уходит в фон, но остаётся видимым', () => {
    const idle = ringLook('artillery', false);
    expect(idle.alpha).toBeGreaterThan(0);
    expect(idle.alpha).toBeLessThan(0.5);
  });

  it('ПРИЦЕЛ — ТОЛЬКО ПРО АРТИЛЛЕРИЮ: у эскадрильи и ПВО вид от него не зависит', () => {
    expect(ringLook('shuttle', true)).toEqual(ringLook('shuttle', false));
    expect(ringLook('aa', true)).toEqual(ringLook('aa', false));
  });

  it('ПВО ЗАМЕТНЕЕ РАДИУСОВ: это отметка на мире, и утонуть в фоне ей нельзя', () => {
    expect(ringLook('aa', false).alpha).toBeGreaterThan(ringLook('artillery', false).alpha);
    expect(ringLook('aa', false).alpha).toBeGreaterThan(ringLook('shuttle', false).alpha);
  });

  it('у ПВО СВОЙ пунктир — отметка не должна читаться как обрезанный радиус', () => {
    expect(ringLook('aa', false).dash).not.toEqual(ringLook('artillery', false).dash);
  });

  it('ПРОЗРАЧНОСТЬ ДУБЛЯ НЕ ПОТЕРЯНА: слитое кольцо не тусклее того, что рисовал маркер', () => {
    // маркер выбранного флота рисовал своё кольцо на 0.42 в покое и 0.7 при прицеле
    expect(ringLook('artillery', false).alpha).toBeGreaterThanOrEqual(0.42);
    expect(ringLook('artillery', true).alpha).toBeGreaterThanOrEqual(0.7);
  });

  it('все виды рисуются видимой линией', () => {
    for (const kind of ['artillery', 'shuttle', 'aa'] as RangeKind[])
      for (const aiming of [true, false]) {
        const look = ringLook(kind, aiming);
        expect(look.alpha).toBeGreaterThan(0);
        expect(look.width).toBeGreaterThan(0);
        expect(look.dash[0]).toBeGreaterThan(0);
        expect(look.dash[1]).toBeGreaterThan(0);
      }
  });

  it('вид стабилен', () => {
    expect(ringLook('artillery', true)).toEqual(ringLook('artillery', true));
  });
});

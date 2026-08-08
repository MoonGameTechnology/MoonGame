import { describe, it, expect } from 'vitest';
import type { GameData, GameState } from '../../packages/shared-core/src/index';
import type { ConstructionPayload } from './buildQueue';
import {
  activeConstruction,
  buildDurationHours,
  constructionPayload,
  hoursLeft,
  laneOfPayload,
  barPct,
  progressPct,
} from './buildProgress';

const HOUR = 3_600_000;

/** Данные ровно в той части, которую читает расчёт длительности. */
const data = {
  units: { cruiser: { buildTimeHours: 4 } },
  buildings: {
    mine: {
      buildTimeHours: 6,
      upgrades: [{ buildTimeHours: 10 }, { buildTimeHours: 20 }],
    },
  },
} as unknown as GameData;

/** Состояние ровно в той части, которую читает выбор головы. */
const withScheduled = (
  events: Array<{ type: string; at: number; seq: number; payload: unknown }>,
): GameState => ({ scheduled: events }) as unknown as GameState;

const build = (over: Partial<ConstructionPayload> = {}): ConstructionPayload =>
  ({ planetId: 'C1R1', kind: 'building', building: 'mine', ...over }) as ConstructionPayload;

const evt = (at: number, seq: number, payload: unknown, type = 'construction.complete') => ({
  type,
  at,
  seq,
  payload,
});

describe('стройка — что это за нагрузка', () => {
  it('нагрузка без мира — не стройка', () => {
    expect(constructionPayload({ kind: 'unit' })).toBeNull();
    expect(constructionPayload(null)).toBeNull();
    expect(constructionPayload('строка')).toBeNull();
  });

  it('нагрузка с миром принимается', () => {
    expect(constructionPayload({ planetId: 'C1R1' })).toEqual({ planetId: 'C1R1' });
  });

  it('юниты идут своей полосой, здания и апгрейды — общей', () => {
    expect(laneOfPayload(build({ kind: 'unit', unit: 'cruiser' }))).toBe('units');
    expect(laneOfPayload(build({ kind: 'building' }))).toBe('buildings');
    expect(laneOfPayload(build({ kind: 'upgrade', level: 2 }))).toBe('buildings');
  });
});

describe('стройка — какая идёт сейчас', () => {
  it('из двух ближайшей считается та, что завершится РАНЬШЕ', () => {
    const s = withScheduled([evt(5000, 1, build()), evt(1000, 2, build())]);
    expect(activeConstruction(s, 'C1R1', 'buildings')?.at).toBe(1000);
  });

  it('РАВНОЕ время различает порядковый номер — иначе полоса прыгала бы между стройками', () => {
    const s = withScheduled([evt(1000, 7, build()), evt(1000, 3, build())]);
    expect(activeConstruction(s, 'C1R1', 'buildings')?.seq).toBe(3);
  });

  it('чужой мир не считается своим', () => {
    const s = withScheduled([evt(1000, 1, build({ planetId: 'C2R2' }))]);
    expect(activeConstruction(s, 'C1R1', 'buildings')).toBeNull();
  });

  it('полосы не смешиваются: юнит не отвечает за здания и наоборот', () => {
    const s = withScheduled([
      evt(1000, 1, build({ kind: 'unit', unit: 'cruiser' })),
      evt(2000, 2, build({ kind: 'building' })),
    ]);
    expect(activeConstruction(s, 'C1R1', 'units')?.at).toBe(1000);
    expect(activeConstruction(s, 'C1R1', 'buildings')?.at).toBe(2000);
  });

  it('события ДРУГОГО вида в расписании игнорируются', () => {
    const s = withScheduled([evt(1000, 1, build(), 'battle.tick')]);
    expect(activeConstruction(s, 'C1R1', 'buildings')).toBeNull();
  });

  it('мусор в нагрузке не роняет выбор', () => {
    const s = withScheduled([evt(1000, 1, null), evt(2000, 2, build())]);
    expect(activeConstruction(s, 'C1R1', 'buildings')?.at).toBe(2000);
  });

  it('пустое расписание — стройки нет', () => {
    expect(activeConstruction(withScheduled([]), 'C1R1', 'buildings')).toBeNull();
  });
});

describe('стройка — сколько она длится', () => {
  it('юнит берёт своё время из данных', () => {
    expect(buildDurationHours(build({ kind: 'unit', unit: 'cruiser' }), data)).toBe(4);
  });

  it('здание берёт своё', () => {
    expect(buildDurationHours(build({ kind: 'building', building: 'mine' }), data)).toBe(6);
  });

  it('АПГРЕЙД на уровень L лежит в upgrades[L-2] — нулевой элемент это переход на 2-й', () => {
    expect(buildDurationHours(build({ kind: 'upgrade', building: 'mine', level: 2 }), data)).toBe(
      10,
    );
    expect(buildDurationHours(build({ kind: 'upgrade', building: 'mine', level: 3 }), data)).toBe(
      20,
    );
  });

  it('апгрейд за пределами таблицы — ноль часов, а не падение', () => {
    expect(buildDurationHours(build({ kind: 'upgrade', building: 'mine', level: 9 }), data)).toBe(
      0,
    );
    expect(buildDurationHours(build({ kind: 'upgrade', building: 'mine', level: 1 }), data)).toBe(
      0,
    );
  });

  it('неизвестные данные — ноль часов', () => {
    expect(buildDurationHours(build({ kind: 'unit', unit: 'нет-такого' }), data)).toBe(0);
    expect(buildDurationHours(build({ building: 'нет-такого' }), data)).toBe(0);
    expect(buildDurationHours(build({ kind: 'building', building: undefined }), data)).toBe(0);
  });
});

describe('стройка — насколько продвинулась', () => {
  const active = (at: number, payload = build()) => ({ at, seq: 1, payload });

  it('только началась — около нуля', () => {
    // здание на 6 часов, до конца ровно 6 часов
    expect(progressPct(active(6 * HOUR), 0, data, HOUR)).toBe(0);
  });

  it('половина срока — половина полосы', () => {
    expect(progressPct(active(6 * HOUR), 3 * HOUR, data, HOUR)).toBe(50);
  });

  it('срок вышел — полная полоса', () => {
    expect(progressPct(active(6 * HOUR), 6 * HOUR, data, HOUR)).toBe(100);
  });

  it('снимок из прошлого не рисует отрицательную полосу', () => {
    expect(progressPct(active(6 * HOUR), -100 * HOUR, data, HOUR)).toBe(0);
  });

  it('часы убежали вперёд — полоса не переполняется', () => {
    expect(progressPct(active(6 * HOUR), 100 * HOUR, data, HOUR)).toBe(100);
  });

  it('длительности в данных нет — «готово», а не NaN', () => {
    const pct = progressPct(active(5000, build({ building: 'нет-такого' })), 0, data, HOUR);
    expect(pct).toBe(100);
    expect(Number.isNaN(pct)).toBe(false);
  });
});

describe('стройка — остаток времени', () => {
  it('остаток считается от текущего часа мира', () => {
    expect(hoursLeft(5 * HOUR, 2 * HOUR, HOUR)).toBe(3);
  });

  it('срок прошёл — остаток ноль, а не отрицательное число', () => {
    expect(hoursLeft(1 * HOUR, 5 * HOUR, HOUR)).toBe(0);
  });
});

describe('barPct — полоса от готовых чисел (живой патчер панели, REFM-77)', () => {
  const active = (at: number, payload = build()) => ({ at, seq: 1, payload });

  it('совпадает с progressPct на тех же входах — одна формула, а не две', () => {
    const a = active(6 * HOUR);
    const dur = 6 * HOUR;
    for (const now of [0, 1.5 * HOUR, 3 * HOUR, 6 * HOUR]) {
      expect(barPct(a.at, dur, now)).toBe(progressPct(a, now, data, HOUR));
    }
  });

  it('ПРОСРОЧЕННАЯ РАБОТА НЕ УЕЗЖАЕТ ЗА КРАЙ: кадр мог прийти позже срока', () => {
    expect(barPct(100, 100, 500)).toBe(100);
  });

  it('ЕЩЁ НЕ НАЧАТАЯ НЕ УХОДИТ В МИНУС', () => {
    expect(barPct(100, 10, 0)).toBe(0);
  });

  it('НУЛЕВАЯ И БИТАЯ ДЛИТЕЛЬНОСТЬ — «ГОТОВО», а не NaN в ширине элемента', () => {
    expect(barPct(100, 0, 0)).toBe(100);
    expect(barPct(100, -5, 0)).toBe(100);
    expect(barPct(100, Number.NaN, 0)).toBe(100);
  });
});

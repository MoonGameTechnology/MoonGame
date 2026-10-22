import { describe, expect, it } from 'vitest';
import type { CorpInfrastructureState } from '../packages/protocol/src/corpInfrastructure';
import type { CorpRole } from '../packages/server/src/store/types';
import { updateCorpInfrastructure } from '../packages/server/src/corpConstruction';
import {
  CORP_HQ,
  corpBuildingStatus,
  corpCanOrder,
  corpInitials,
  corpLevel,
  corpLevelPlan,
  corpLevelTable,
  corpLotState,
  corpOpensAt,
  corpRequirements,
} from './corpBase';

const H = 3_600_000;

/** Ответ сервера для корпорации с такими уровнями, казной и стройкой — тем же кодом,
 *  каким его собирает сервер, чтобы тест не разошёлся с настоящим ответом. */
function view(
  levels: Record<string, number>,
  influence: number,
  role: CorpRole = 'head',
  construction: CorpInfrastructureState['construction'] = null,
) {
  const saved: CorpInfrastructureState = { levels, construction, accruedAt: 0, remainder: 0 };
  const result = updateCorpInfrastructure('c', 'a', role, influence, saved, 0).result;
  if (!result.ok) throw new Error(result.code);
  return result.infrastructure;
}
const building = (v: ReturnType<typeof view>, id: string) => v.buildings.find((b) => b.id === id)!;

describe('база корпорации (CORP-3)', () => {
  it('уровень корпорации — уровень штаба; нет штаба — нет уровня', () => {
    expect(corpLevel(view({}, 0))).toBe(0);
    expect(corpLevel(view({ headquarters: 2 }, 0))).toBe(2);
    const v = view({}, 0);
    expect(corpLevel({ ...v, buildings: v.buildings.filter((b) => b.id !== CORP_HQ) })).toBeNull();
  });

  it('участок панорамы: стройка, построено, можно построить, закрыто', () => {
    const job = { buildingId: 'supply_center', level: 1, startedAt: 0, completesAt: H, cost: 60 };
    const v = view({ headquarters: 1, engineering_complex: 0 }, 0, 'head', job);
    expect(corpLotState(v, building(v, 'supply_center'))).toBe('build');
    expect(corpLotState(v, building(v, CORP_HQ))).toBe('built');
    expect(corpLotState(v, building(v, 'engineering_complex'))).toBe('open');
    const fresh = view({}, 0);
    expect(corpLotState(fresh, building(fresh, 'supply_center'))).toBe('locked');
    expect(corpLotState(fresh, building(fresh, CORP_HQ))).toBe('open');
  });

  it('строка под зданием: своя стройка, максимум, нужен штаб, очередь, влияние, можно', () => {
    const job = { buildingId: 'supply_center', level: 2, startedAt: 0, completesAt: H, cost: 180 };
    const busy = view({ headquarters: 3, supply_center: 1, engineering_complex: 3 }, 1000, 'head', job);
    expect(corpBuildingStatus(busy, building(busy, 'supply_center'))).toEqual({ kind: 'job', level: 2 });
    // Последний уровень называется последним, даже пока очередь занята другим зданием.
    expect(corpBuildingStatus(busy, building(busy, 'engineering_complex'))).toEqual({ kind: 'max' });
    expect(corpBuildingStatus(busy, building(busy, CORP_HQ))).toEqual({ kind: 'max' });

    const low = view({ headquarters: 1, supply_center: 1 }, 1000);
    expect(corpBuildingStatus(low, building(low, 'supply_center'))).toEqual({
      kind: 'locked',
      headquarters: 2,
      first: false,
    });
    const queued = view({ headquarters: 1 }, 1000, 'head', {
      buildingId: CORP_HQ,
      level: 2,
      startedAt: 0,
      completesAt: H,
      cost: 120,
    });
    expect(corpBuildingStatus(queued, building(queued, 'supply_center'))).toEqual({ kind: 'busy' });

    const poor = view({ headquarters: 1 }, 50);
    expect(corpBuildingStatus(poor, building(poor, 'supply_center'))).toEqual({
      kind: 'short',
      missing: 10,
      cost: 60,
    });
    const rich = view({ headquarters: 1 }, 60);
    expect(corpBuildingStatus(rich, building(rich, 'supply_center'))).toEqual({
      kind: 'can',
      cost: 60,
      durationMs: 3 * H,
      first: true,
    });
  });

  it('не главе — та же причина, что и главе, а цена и время — без кнопки', () => {
    const member = view({ headquarters: 1 }, 60, 'member');
    const supply = building(member, 'supply_center');
    expect(supply.blocked).toBe('E_FORBIDDEN');
    expect(corpBuildingStatus(member, supply)).toEqual({
      kind: 'view',
      cost: 60,
      durationMs: 3 * H,
      first: true,
    });
    expect(corpCanOrder(member, supply)).toBe(false);
    const poor = view({ headquarters: 1 }, 10, 'member');
    expect(corpBuildingStatus(poor, building(poor, 'supply_center')).kind).toBe('short');
  });

  it('кнопку включает только сервер: вывод «можно» без согласия сервера её не включает', () => {
    const v = view({ headquarters: 1 }, 60);
    const supply = building(v, 'supply_center');
    expect(corpCanOrder(v, supply)).toBe(true);
    const disagreeing = { ...supply, blocked: 'E_CORP_BUILD_BUSY' as const };
    expect(corpCanOrder(v, disagreeing)).toBe(false);
    expect(corpBuildingStatus(v, disagreeing).kind).toBe('view');
    expect(corpCanOrder({ ...v, canBuild: false }, supply)).toBe(false);
  });

  it('время в строке — с поправкой инженерного комплекса', () => {
    const v = view({ headquarters: 2, engineering_complex: 1 }, 1000);
    const status = corpBuildingStatus(v, building(v, 'supply_center'));
    expect(status).toEqual({ kind: 'can', cost: 60, durationMs: 2.7 * H, first: true });
  });

  it('уровень штаба открывает уровни других зданий, которым нужен ровно он', () => {
    const v = view({}, 0);
    expect(corpOpensAt(v, 1)).toEqual([
      { buildingId: 'supply_center', nameKey: 'corp.building.supply-center', level: 1 },
      { buildingId: 'engineering_complex', nameKey: 'corp.building.engineering-complex', level: 1 },
    ]);
    expect(corpOpensAt(v, 3).map((o) => [o.buildingId, o.level])).toEqual([
      ['supply_center', 3],
      ['engineering_complex', 3],
    ]);
    expect(corpOpensAt(v, 9)).toEqual([]);
  });

  it('карточка уровня: следующий штаб, хватает ли казны, что откроет; на высшем — ничего', () => {
    const fresh = corpLevelPlan(view({}, 0))!;
    expect(fresh).toMatchObject({ level: 0, max: 3 });
    expect(fresh.next).toMatchObject({ level: 1, cost: 0, durationMs: H, enough: true });
    expect(fresh.next!.opens).toHaveLength(2);
    const poor = corpLevelPlan(view({ headquarters: 1 }, 100))!;
    expect(poor.next).toMatchObject({ level: 2, cost: 120, enough: false });
    expect(corpLevelPlan(view({ headquarters: 3 }, 0))).toEqual({ level: 3, max: 3, next: null });
  });

  it('таблица уровней: цена и время по каталогу, текущий отмечен', () => {
    const rows = corpLevelTable(view({ headquarters: 2, engineering_complex: 2 }, 0));
    expect(rows.map((r) => [r.level, r.cost, r.durationMs, r.current])).toEqual([
      [1, 0, H, false],
      [2, 120, 6 * H, true],
      [3, 360, 12 * H, false],
    ]);
    expect(rows[0]!.opens.map((o) => o.buildingId)).toEqual(['supply_center', 'engineering_complex']);
  });

  it('условия уровня здания: штаб, влияние, очередь и время; у штаба нет условия штаба', () => {
    const job = { buildingId: CORP_HQ, level: 2, startedAt: 0, completesAt: H, cost: 120 };
    const v = view({ headquarters: 1, engineering_complex: 1 }, 40, 'head', job);
    expect(corpRequirements(v, building(v, 'supply_center'))).toEqual([
      { kind: 'hq', level: 1, ok: true },
      { kind: 'cost', cost: 60, treasury: 40, ok: false },
      { kind: 'queue', ok: false, busyWith: 'corp.building.headquarters' },
      { kind: 'time', durationMs: 2.7 * H, reduction: 10 },
    ]);
    const hq = corpRequirements(view({ headquarters: 1 }, 500), building(view({ headquarters: 1 }, 500), CORP_HQ));
    expect(hq.map((r) => r.kind)).toEqual(['cost', 'queue', 'time']);
    expect(hq[1]).toEqual({ kind: 'queue', ok: true, busyWith: null });
    const top = view({ headquarters: 3 }, 0);
    expect(corpRequirements(top, building(top, CORP_HQ))).toEqual([]);
  });

  it('знак на гербе: первые буквы двух слов или две буквы одного слова', () => {
    expect(corpInitials('Северный щит')).toBe('СЩ');
    expect(corpInitials('Орден Вектора Третьего')).toBe('ОВ');
    expect(corpInitials('Тайга-7')).toBe('Т7');
    expect(corpInitials('альфа')).toBe('АЛ');
    expect(corpInitials('  ')).toBe('?');
  });
});

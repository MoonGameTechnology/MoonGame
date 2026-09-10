/**
 * ЭСКАДРА В ПАНЕЛИ (SHU-4.3) — решения карточки соединения.
 *
 * SHU-4.2 дал эскадре личность в ядре, но панель её не показывала: ангар рисовался
 * одним списком машин, а кнопки брали ПЕРВОЕ живое звено. Игрок не мог ни выбрать, кому
 * лететь, ни собрать состав, ни погрузить десант заранее — всё это умело только ядро.
 */
import { describe, expect, it } from 'vitest';
import { data } from './game';
import {
  mergeTargets,
  splitOne,
  squadronCards,
  squadronCallsignOf,
  troopsInputForSquadron,
} from './squadronPanel';
import type { HangarView } from './hangarPanel';
import type { Squadron } from '../../packages/shared-core/src/index';

const sq = (id: string, units: Array<[string, number]>, cargo?: Array<[string, number]>): Squadron => ({
  id,
  units: units.map(([unit, count]) => ({ unit, count })),
  ...(cargo ? { cargo: cargo.map(([unit, count]) => ({ unit, count })) } : {}),
});

const view = (squadrons: Squadron[], over: Partial<HangarView> = {}): HangarView => ({
  squadrons,
  stacks: squadrons.flatMap((q) => q.units),
  used: squadrons.reduce((n, q) => n + q.units.reduce((m, st) => m + st.count, 0), 0),
  bay: 6,
  free: 6,
  blocked: null,
  ...over,
});

describe('SHU-4.3 — карточка эскадры', () => {
  it('У КАЖДОЙ ЭСКАДРЫ СВОЯ КАРТОЧКА И СВОЙ ПОЗЫВНОЙ — иначе выбирать не из чего', () => {
    const cards = squadronCards(view([sq('sq:p1:1', [['interceptor', 2]]), sq('sq:p1:2', [['bomber', 1]])]), {
      mine: true,
      data,
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]?.id).toBe('sq:p1:1');
    expect(cards[0]?.name).not.toBe(cards[1]?.name); // разные соединения — разные имена
    expect(cards[0]?.machines).toBe(2);
  });

  it('ПОЗЫВНОЙ ВЫВОДИТСЯ ИЗ ID, а не хранится: один id — одно имя на всех клиентах', () => {
    expect(squadronCallsignOf('sq:p1:7')).toBe(squadronCallsignOf('sq:p1:7'));
    expect(squadronCallsignOf('sq:p1:7')).not.toBe(squadronCallsignOf('sq:p1:8'));
  });

  it('ЧУЖОЙ АНГАР — ТОЛЬКО СОСТАВ: приказов по чужой эскадре не предлагают вовсе', () => {
    const cards = squadronCards(view([sq('sq:p2:1', [['interceptor', 3]])]), { mine: false, data });
    expect(cards[0]?.canStrike).toBe(false);
    expect(cards[0]?.canSplit).toBe(false);
    expect(cards[0]?.canLoad).toBe(false);
  });

  it('ПУСТЫЕ ЗВЕНЬЯ НЕ ПОКАЗЫВАЮТСЯ: соединение без бортов — не соединение', () => {
    expect(squadronCards(view([sq('sq:p1:1', [['interceptor', 0]])]), { mine: true, data })).toHaveLength(0);
  });
});

describe('SHU-4.3 — делёж одной кнопкой', () => {
  it('«ОТДЕЛИТЬ» БЕРЁТ ОДНУ МАШИНУ: повторный тап отделяет ещё одну, состав собирается по шагам', () => {
    expect(splitOne(sq('sq:p1:1', [['interceptor', 3]]))).toEqual({ unit: 'interceptor', count: 1 });
  });

  it('ОДИНОЧКУ ДЕЛИТЬ НЕЧЕГО — кнопки нет, а не «есть и отказывает»', () => {
    expect(splitOne(sq('sq:p1:1', [['interceptor', 1]]))).toBeNull();
  });

  it('ГРУЖЁНУЮ НЕ ДЕЛИМ: то же правило, что в ядре (`E_HAS_CARGO`), и кнопки тут нет', () => {
    expect(splitOne(sq('sq:p1:1', [['lander', 3]], [['militia', 2]]))).toBeNull();
  });

  it('в смешанном звене отделяется ПЕРВЫЙ тип — выбор детерминирован, а не «какой-нибудь»', () => {
    expect(splitOne(sq('sq:p1:1', [['bomber', 1], ['interceptor', 2]]))).toEqual({
      unit: 'bomber',
      count: 1,
    });
  });
});

describe('SHU-4.3 — слияние двумя тапами', () => {
  it('ПРИЁМНИКИ — ВСЕ ОСТАЛЬНЫЕ ЗВЕНЬЯ этой базы, кроме самого источника', () => {
    const v = view([sq('a', [['interceptor', 1]]), sq('b', [['bomber', 1]]), sq('c', [['bomber', 1]])]);
    expect(mergeTargets(v, 'a')).toEqual(['b', 'c']);
  });

  it('ОДНО ЗВЕНО — СЛИВАТЬ НЕ С ЧЕМ: кнопки нет', () => {
    const v = view([sq('a', [['interceptor', 2]])]);
    expect(mergeTargets(v, 'a')).toEqual([]);
    expect(squadronCards(v, { mine: true, data })[0]?.canMerge).toBe(false);
  });
});

describe('SHU-4.3 — десант грузится в КОНКРЕТНУЮ эскадру', () => {
  const ground = [{ unit: 'militia', count: 6 }];

  it('ТРЮМ И ВМЕСТИМОСТЬ БЕРУТСЯ У ЭСКАДРЫ, а не у мира: грузят в звено, а не в порт', () => {
    const inp = troopsInputForSquadron(sq('sq:p1:1', [['landing_shuttle', 2]]), ground, data);
    const cap = (data.units.landing_shuttle?.stats.cargoCapacity ?? 0) * 2;
    expect(inp.capacity).toBe(cap);
    expect(inp.used).toBe(0);
    expect(inp.units.find((u) => u.unit === 'militia')?.garrison).toBe(6);
  });

  it('УЖЕ ПОГРУЖЕННОЕ ВИДНО КАК ТРЮМ — иначе игрок не поймёт, что можно ссадить', () => {
    const inp = troopsInputForSquadron(
      sq('sq:p1:1', [['landing_shuttle', 2]], [['militia', 4]]),
      ground,
      data,
    );
    expect(inp.used).toBe(4);
    expect(inp.units.find((u) => u.unit === 'militia')?.hold).toBe(4);
  });

  it('ЗВЕНО БЕЗ ТРЮМА НЕ ГРУЗЯТ, А ДЕСАНТНОЕ — ГРУЗЯТ: признак в вместимости, не в имени', () => {
    const bare = view([sq('sq:p1:1', [['interceptor', 2]])]);
    expect(squadronCards(bare, { mine: true, data })[0]?.canLoad).toBe(false);
    const lander = view([sq('sq:p1:2', [['landing_shuttle', 1]])]);
    expect(squadronCards(lander, { mine: true, data })[0]?.canLoad).toBe(true);
  });

  it('ОЧЕРЕДЕЙ И РЕЗЕРВОВ У ЭСКАДРЫ НЕТ: погрузка в трюм мгновенна (ядро, SHU-4.2)', () => {
    const inp = troopsInputForSquadron(sq('sq:p1:1', [['landing_shuttle', 1]]), ground, data);
    expect(inp.reservedCargo).toBe(0);
    expect(inp.units.every((u) => u.queued === 0 && u.reserved === 0)).toBe(true);
  });
});

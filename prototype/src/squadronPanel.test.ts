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
} from './squadronPanel';
import type { HangarView } from './hangarPanel';
import type { Squadron } from '../../packages/shared-core/src/index';

const sq = (id: string, units: Array<[string, number]>, cargo?: Array<[string, number]>): Squadron => ({
  id,
  units: units.map(([unit, count]) => ({ unit, count })),
  ...(cargo ? { cargo: cargo.map(([unit, count]) => ({ unit, count })) } : {}),
});

const view = (squadrons: Squadron[], over: Partial<HangarView> = {}): HangarView => ({
  kind: 'port',
  squadrons,
  sizes: squadrons.map((q) => q.units.reduce((m, st) => m + st.count, 0)),
  stacks: squadrons.flatMap((q) => q.units),
  used: squadrons.reduce((n, q) => n + q.units.reduce((m, st) => m + st.count, 0), 0),
  bay: 6,
  aloft: 0,
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

  it('СО СМЕШАННЫМ ДЕСАНТОМ НЕ ДЕЛИМ: то же правило, что в ядре (`E_HAS_CARGO`), и кнопки тут нет', () => {
    expect(splitOne(sq('sq:p1:1', [['landing_shuttle', 3]], [['militia', 2], ['tank', 1]]))).toBeNull();
  });

  it('ОДНОРОДНЫЙ ДЕСАНТ ДЕЛИТСЯ: отделённый борт уносит своего бойца (SHU-5.2)', () => {
    expect(splitOne(sq('sq:p1:1', [['landing_shuttle', 3]], [['militia', 3]]))).toEqual({
      unit: 'landing_shuttle',
      count: 1,
    });
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

describe('SHU-5.2 — десант в трюме только показывается', () => {
  it('КАРТОЧКА НЕСЁТ ТРЮМ ЗВЕНА: челнок строится с бойцом внутри, игрок видит, кого везёт', () => {
    const cards = squadronCards(view([sq('sq:p1:1', [['landing_shuttle', 2]], [['militia', 2]])]), {
      mine: true,
      data,
    });
    expect(cards[0]?.cargo).toEqual([{ unit: 'militia', count: 2 }]);
  });
});

describe('SHU-5.5 — места и корпус звена', () => {
  it('КАРТОЧКА НАЗЫВАЕТ МЕСТА ЗВЕНА ПО cargoSize и корпус подбитого борта', () => {
    const hurt: Squadron = { ...sq('sq:p1:1', [['heavy_striker', 2]]), damage: 15 };
    const [card] = squadronCards(view([hurt]), { mine: true, data });
    // Тяжёлый страйкер занимает два места: два борта — четыре места трюма.
    expect(card?.places).toBe(4);
    expect(card?.hull).toBe(50); // 15 урона из корпуса 30
  });

  it('ЦЕЛОЕ ЗВЕНО КОРПУС НЕ ПОКАЗЫВАЕТ', () => {
    const [card] = squadronCards(view([sq('sq:p1:1', [['interceptor', 2]])]), { mine: true, data });
    expect(card?.places).toBe(2);
    expect(card?.hull).toBeNull();
  });
});

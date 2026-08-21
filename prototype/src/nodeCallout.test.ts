import { describe, it, expect } from 'vitest';
import {
  calloutInk,
  calloutLine,
  calloutTier,
  type CalloutSight,
  type CalloutTier,
} from './nodeCallout';

const вид = (over: Partial<CalloutSight> = {}): CalloutSight => ({
  detail: 1,
  tier: 'world',
  garrison: 0,
  buildings: 0,
  ...over,
});

describe('подпись узла — мир или транзит', () => {
  it('МИР — ОТДЕЛЬНЫЙ ТИР: он приз, а не участок маршрута', () => {
    expect(calloutTier('planet')).toBe('world');
  });

  it('всё остальное — прочий сектор', () => {
    for (const s of ['empty', 'asteroid', 'nebula', 'wreck', 'storm'])
      expect(calloutTier(s)).toBe('sector');
  });
});

// Подпись достаётся ТОЛЬКО опознанному узлу: неопознанный перехвачен фог-маркером
// выше по циклу отрисовки (REFM-117.1, см. шапку модуля), поэтому «туманных» чернил
// здесь больше нет — вопрос «а если не опознан» решается не тут.
describe('подпись узла — чем красить имя', () => {
  it('ЦВЕТ ВЛАДЕЛЬЦА — ЭТО РАЗВЕДДАННЫЕ: у опознанного узла имя носит его хозяина', () => {
    expect(calloutInk(true)).toBe('owner');
  });

  it('НИЧЕЙНЫЙ — СВОЙ ОТТЕНОК: «здесь никого» это тоже сведение, а не «не знаем»', () => {
    expect(calloutInk(false)).toBe('neutral');
    expect(calloutInk(false)).not.toBe(calloutInk(true));
  });

  it('ИСЧЕРПЫВАЮЩЕ: чернил ровно два, и оба про опознанный узел', () => {
    expect([true, false].map((own) => `${own}→${calloutInk(own)}`)).toEqual([
      'true→owner',
      'false→neutral',
    ]);
  });
});

describe('подпись узла — вторая строка', () => {
  it('НА СХЕМАТИЧНОМ ВИДЕ ТЕЛЕМЕТРИИ НЕТ: там она нечитаема, а место занимает', () => {
    expect(calloutLine(вид({ detail: 0 }))).toEqual({ do: 'none' });
    expect(calloutLine(вид({ detail: 0, tier: 'sector' }))).toEqual({ do: 'none' });
  });

  it('МИР ОТЧИТЫВАЕТСЯ ВСЕГДА — по нему принимают решения', () => {
    expect(calloutLine(вид({ tier: 'world', garrison: 0, buildings: 0 }))).toEqual({ do: 'stats' });
  });

  it('ПУСТОЙ ТИХИЙ СЕКТОР МОЛЧИТ: «G:0 B:—» у путевой точки — шум', () => {
    expect(calloutLine(вид({ tier: 'sector' }))).toEqual({ do: 'none' });
  });

  it('непустой сектор отчитывается — там есть о чём', () => {
    expect(calloutLine(вид({ tier: 'sector', garrison: 2 }))).toEqual({ do: 'stats' });
    expect(calloutLine(вид({ tier: 'sector', buildings: 1 }))).toEqual({ do: 'stats' });
  });

  it('ИСЧЕРПЫВАЮЩЕ по всем сочетаниям признаков', () => {
    const исходы: Record<string, number> = {};
    for (const detail of [0, 0.5, 1])
      for (const tier of ['world', 'sector'] as CalloutTier[])
        for (const garrison of [0, 3])
          for (const buildings of [0, 2]) {
            const r = calloutLine({ detail, tier, garrison, buildings });
            const ждём =
              detail <= 0
                ? 'none'
                : tier === 'world' || garrison > 0 || buildings > 0
                  ? 'stats'
                  : 'none';
            expect(r.do).toBe(ждём);
            исходы[r.do] = (исходы[r.do] ?? 0) + 1;
          }
    // 24 сочетания: 8 схематичных (detail 0) + 2 пустых тихих сектора → none; прочее — stats.
    expect(исходы).toEqual({ none: 10, stats: 14 });
  });

  it('ИСХОДОВ РОВНО ДВА: «нет телеметрии» здесь больше не живёт', () => {
    const все = new Set<string>();
    for (const detail of [0, 1])
      for (const tier of ['world', 'sector'] as CalloutTier[])
        for (const garrison of [0, 3])
          for (const buildings of [0, 2])
            все.add(calloutLine({ detail, tier, garrison, buildings }).do);
    expect([...все].sort()).toEqual(['none', 'stats']);
  });
});

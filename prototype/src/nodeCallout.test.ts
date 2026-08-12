import { describe, it, expect } from 'vitest';
import {
  calloutInk,
  calloutLine,
  calloutTier,
  type CalloutSight,
  type CalloutTier,
} from './nodeCallout';

const вид = (over: Partial<CalloutSight> = {}): CalloutSight => ({
  identified: true,
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

describe('подпись узла — чем красить имя', () => {
  it('ЦВЕТ ВЛАДЕЛЬЦА — ТОЛЬКО У ОПОЗНАННОГО: иначе туман перестал бы скрывать', () => {
    expect(calloutInk(false, true)).toBe('fogged');
    expect(calloutInk(true, true)).toBe('owner');
  });

  it('НИЧЕЙНЫЙ ОПОЗНАННЫЙ — СВОЙ ОТТЕНОК: «здесь никого» это тоже сведение', () => {
    expect(calloutInk(true, false)).toBe('neutral');
    expect(calloutInk(true, false)).not.toBe(calloutInk(false, false));
  });

  it('ИСЧЕРПЫВАЮЩЕ: три чернил на четыре сочетания, туман съедает владельца', () => {
    const свод = [true, false].flatMap((id) =>
      [true, false].map((own) => `${id}/${own}→${calloutInk(id, own)}`),
    );
    expect(свод).toEqual([
      'true/true→owner',
      'true/false→neutral',
      'false/true→fogged',
      'false/false→fogged',
    ]);
  });
});

describe('подпись узла — вторая строка', () => {
  it('НА СХЕМАТИЧНОМ ВИДЕ ТЕЛЕМЕТРИИ НЕТ: там она нечитаема, а место занимает', () => {
    expect(calloutLine(вид({ detail: 0 }))).toEqual({ do: 'none' });
    expect(calloutLine(вид({ detail: 0, identified: false }))).toEqual({ do: 'none' });
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

  // Ветка недостижима в нынешнем порядке отрисовки (фог-маркер перехватывает узел
  // выше по циклу) — правило перенесено дословно, тест держит его контракт.
  it('НЕОПОЗНАННЫЙ ГОВОРИТ СЛОВАМИ: пустота читалась бы как «разведан и пуст»', () => {
    expect(calloutLine(вид({ identified: false }))).toEqual({ do: 'unknown' });
    expect(calloutLine(вид({ identified: false, tier: 'sector' }))).toEqual({ do: 'unknown' });
  });

  it('ИСЧЕРПЫВАЮЩЕ по всем сочетаниям признаков', () => {
    const исходы: Record<string, number> = {};
    for (const identified of [true, false])
      for (const detail of [0, 0.5, 1])
        for (const tier of ['world', 'sector'] as CalloutTier[])
          for (const garrison of [0, 3])
            for (const buildings of [0, 2]) {
              const r = calloutLine({ identified, detail, tier, garrison, buildings });
              const ждём =
                detail <= 0
                  ? 'none'
                  : !identified
                    ? 'unknown'
                    : tier === 'world' || garrison > 0 || buildings > 0
                      ? 'stats'
                      : 'none';
              expect(r.do).toBe(ждём);
              исходы[r.do] = (исходы[r.do] ?? 0) + 1;
            }
    expect(исходы).toEqual({ none: 18, unknown: 16, stats: 14 });
  });
});

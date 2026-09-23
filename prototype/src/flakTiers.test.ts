import { describe, it, expect } from 'vitest';
import {
  FLAK_LIFE_MS,
  flakBurstRadius,
  flakDashOffset,
  flakLook,
  flakTier,
  type FlakTier,
} from './flakTiers';

const ТИРЫ: FlakTier[] = ['orbital', 'close', 'intercept', 'pointDefense'];

describe('зенитный огонь — какой тир', () => {
  it('признак «ближняя» выбирает тир, а не отдельные свойства', () => {
    expect(flakTier(true)).toBe('close');
    expect(flakTier(false)).toBe('orbital');
  });

  it('ТИР РЕШАЕТ ВЕСЬ ВИД РАЗОМ: одна запись вместо семи тернарников', () => {
    for (const tier of ТИРЫ) {
      const look = flakLook(tier);
      expect(Object.keys(look).sort()).toEqual(
        ['alpha', 'blur', 'burstColor', 'burstFrom', 'burstGrow', 'color', 'dash', 'width'].sort(),
      );
    }
  });

  it('вид тира стабилен — один и тот же ответ на один и тот же тир', () => {
    expect(flakLook('close')).toEqual(flakLook('close'));
  });
});

describe('зенитный огонь — ближний тише орбитального', () => {
  const близкий = flakLook('close');
  const орбитальный = flakLook('orbital');

  it('БЛЕДНЕЕ, ТОНЬШЕ, МЕЛЬЧЕ, СЛАБЕЕ СВЕТИТ — по всем осям сразу', () => {
    expect(близкий.alpha).toBeLessThan(орбитальный.alpha);
    expect(близкий.width).toBeLessThan(орбитальный.width);
    expect(близкий.blur).toBeLessThan(орбитальный.blur);
    expect(близкий.burstFrom).toBeLessThan(орбитальный.burstFrom);
    expect(близкий.burstGrow).toBeLessThan(орбитальный.burstGrow);
  });

  it('ЧАСТАЯ МЕЛОЧЬ НЕ ПЕРЕКРИЧИТ РЕДКИЙ ЗАЛП: вспышка мельче на всей её жизни', () => {
    for (let k = 0; k <= 1; k += 0.05)
      expect(flakBurstRadius(близкий, k)).toBeLessThan(flakBurstRadius(орбитальный, k));
  });

  it('штрих ближнего короче — очередь читается как мелкая', () => {
    expect(близкий.dash[0]).toBeLessThan(орбитальный.dash[0]);
    expect(близкий.dash[1]).toBeLessThan(орбитальный.dash[1]);
  });

  it('цвета тиров разные — их нельзя перепутать даже краем глаза', () => {
    expect(близкий.color).not.toBe(орбитальный.color);
    expect(близкий.burstColor).not.toBe(орбитальный.burstColor);
  });
});

describe('зенитный огонь — вспышка попадания', () => {
  it('ВСПЫШКА РАСТЁТ, А НЕ ПРОСТО ГАСНЕТ: попадание — расширяющийся хлопок', () => {
    for (const tier of ТИРЫ) {
      const look = flakLook(tier);
      expect(flakBurstRadius(look, 0)).toBe(look.burstFrom);
      expect(flakBurstRadius(look, 1)).toBe(look.burstFrom + look.burstGrow);
      expect(flakBurstRadius(look, 0.5)).toBeGreaterThan(flakBurstRadius(look, 0));
    }
  });

  it('рост монотонен — хлопок не дёргается назад', () => {
    const look = flakLook('orbital');
    let prev = -Infinity;
    for (let k = 0; k <= 1; k += 0.01) {
      const r = flakBurstRadius(look, k);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });
});

describe('зенитный огонь — ход трассы', () => {
  it('ТРАССА ПОЛЗЁТ ВВЕРХ: неподвижный пунктир читался бы как линия связи', () => {
    expect(flakDashOffset(0)).toBeCloseTo(0, 12); // на старте штрих ещё не сдвинут
    expect(flakDashOffset(120)).toBeLessThan(flakDashOffset(0));
    expect(flakDashOffset(700)).toBeLessThan(flakDashOffset(120));
  });

  it('за жизнь трассы штрих успевает уйти заметно дальше своего шага', () => {
    const шаг = flakLook('orbital').dash[0] + flakLook('orbital').dash[1];
    expect(Math.abs(flakDashOffset(FLAK_LIFE_MS))).toBeGreaterThan(шаг);
  });
});

describe('SHU-3.1 — перехват это ТРЕТИЙ тир, а не перекрашенная зенитка', () => {
  it('У ПЕРЕХВАТА СВОЙ ЦВЕТ: игрок обязан отличить встречное звено от залпа с земли', () => {
    expect(flakLook('intercept').color).not.toBe(flakLook('orbital').color);
    expect(flakLook('intercept').color).not.toBe(flakLook('close').color);
  });

  it('ОН ЗАМЕТНЕЕ БЛИЖНЕЙ ЗЕНИТКИ: сбитая эскадра — событие дороже дежурной очереди', () => {
    expect(flakLook('intercept').alpha).toBeGreaterThan(flakLook('close').alpha);
    expect(flakLook('intercept').burstGrow).toBeGreaterThan(flakLook('close').burstGrow);
  });
});

describe('зенитный огонь — корабельное ПВО (AUD-17)', () => {
  it('ЭСКОРТ НЕ СЛИВАЕТСЯ НИ С КЕМ: цвет трассы и вспышки свой у каждого из четырёх тиров', () => {
    // Попарно, а не «новый против старых»: пятый тир должен будет пройти ту же проверку,
    // и совпадение двух старых между собой тоже ловится здесь.
    const colors = ТИРЫ.map((t) => flakLook(t).color);
    const bursts = ТИРЫ.map((t) => flakLook(t).burstColor);
    expect(new Set(colors).size).toBe(ТИРЫ.length);
    expect(new Set(bursts).size).toBe(ТИРЫ.length);
  });

  it('и не повторяет цвета, уже занятые на карте: отметку ПКО и цвета владельцев', () => {
    // `R_AA` (main.ts) и `OWNER_COLORS` (packages/client/src/mapRender.ts) — копии здесь
    // намеренно: это список «чего избегать», а не источник цвета.
    const taken = ['#c07dff', '#35d6e6', '#ff5a4d', '#ffb43a', '#b07cff'];
    expect(taken).not.toContain(flakLook('pointDefense').color);
  });

  it('ВЕС — КАК У БЛИЖНЕЙ ЗЕНИТКИ: очередь раз в 20 минут — та же частая мелочь', () => {
    const pd = flakLook('pointDefense');
    const close = flakLook('close');
    expect(pd.alpha).toBe(close.alpha);
    expect(pd.width).toBe(close.width);
    expect(pd.burstGrow).toBe(close.burstGrow);
    // …и потому тише редкого орбитального залпа, как требует правило 2.
    expect(pd.alpha).toBeLessThan(flakLook('orbital').alpha);
  });
});

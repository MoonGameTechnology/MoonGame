import { describe, it, expect } from 'vitest';
import {
  BADGE_BOB,
  BADGE_GAP,
  BADGE_R,
  badgeBob,
  badgeCenterY,
  badgeLook,
  badgeShown,
  badgeTether,
} from './kindBadge';

describe('бейдж типа — когда его рисуют', () => {
  it('НЕТ ЗНАКА ТИПА — НЕТ БЕЙДЖА: пустая капсула обещала бы тип, которого нет', () => {
    expect(badgeShown(false, 1)).toBe(false);
  });

  it('НА СХЕМАТИЧНОМ ВИДЕ БЕЙДЖА НЕТ: лишний ярус поверх и без того тесного узла', () => {
    expect(badgeShown(true, 0)).toBe(false);
  });

  it('знак есть и вид детальный — рисуем', () => {
    expect(badgeShown(true, 1)).toBe(true);
    expect(badgeShown(true, 0.01)).toBe(true);
  });

  it('ИСЧЕРПЫВАЮЩЕ: рисуем ровно при обоих условиях сразу', () => {
    const drawn: string[] = [];
    for (const glyph of [true, false])
      for (const detail of [1, 0]) if (badgeShown(glyph, detail)) drawn.push(`${glyph}/${detail}`);
    expect(drawn).toEqual(['true/1']);
  });
});

describe('бейдж типа — покачивание', () => {
  it('ФАЗА ИЗ КООРДИНАТ УЗЛА: с общей фазой вся карта дрожала бы как одна деталь', () => {
    const now = 1234;
    const a = badgeBob(now, 10, 20);
    const b = badgeBob(now, 300, 20);
    expect(a).not.toBeCloseTo(b, 3);
  });

  it('фаза не зависит от кадра — одинаковые входы дают одинаковый выход', () => {
    expect(badgeBob(777, 5, 6)).toBe(badgeBob(777, 5, 6));
  });

  it('размах ограничен и симметричен — бейдж качается, а не улетает', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 8000; t += 7) {
      const v = badgeBob(t, 3, 4);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi).toBeLessThanOrEqual(BADGE_BOB);
    expect(lo).toBeGreaterThanOrEqual(-BADGE_BOB);
    expect(hi).toBeGreaterThan(BADGE_BOB * 0.99); // размах реально выбирается
    expect(lo).toBeLessThan(-BADGE_BOB * 0.99);
  });

  it('покачивание идёт по времени — бейдж живой, а не приклеенный', () => {
    expect(badgeBob(0, 0, 0)).not.toBeCloseTo(badgeBob(1100, 0, 0), 3);
  });
});

describe('бейдж типа — где он висит', () => {
  const nodeTop = 100; // верх узла на экране (ось Y вниз)

  it('БЕЙДЖ ВЫШЕ УЗЛА: метка типа не должна сливаться с искусством сектора', () => {
    expect(badgeCenterY(nodeTop, 0)).toBeLessThan(nodeTop);
  });

  it('между краем узла и низом капсулы остаётся зазор', () => {
    const cy = badgeCenterY(nodeTop, 0);
    expect(nodeTop - (cy + BADGE_R)).toBe(BADGE_GAP * 2);
  });

  it('покачивание сдвигает капсулу целиком', () => {
    expect(badgeCenterY(nodeTop, 2)).toBe(badgeCenterY(nodeTop, 0) + 2);
  });

  it('даже на полном размахе бейдж не наезжает на узел', () => {
    const cy = badgeCenterY(nodeTop, BADGE_BOB);
    expect(cy + BADGE_R).toBeLessThan(nodeTop);
  });
});

describe('бейдж типа — луч проектора', () => {
  it('ЛУЧ ИДЁТ ОТ КРАЯ УЗЛА ДО НИЗА КАПСУЛЫ: между центрами он прошил бы обоих', () => {
    const nodeTop = 100;
    const cy = badgeCenterY(nodeTop, 0);
    const t = badgeTether(nodeTop, cy);
    expect(t.from).toBe(nodeTop);
    expect(t.to).toBe(cy + BADGE_R);
    expect(t.to).toBeLessThan(t.from); // луч идёт вверх
  });

  it('луч следует за качающейся капсулой', () => {
    const nodeTop = 100;
    const up = badgeTether(nodeTop, badgeCenterY(nodeTop, -BADGE_BOB));
    const down = badgeTether(nodeTop, badgeCenterY(nodeTop, BADGE_BOB));
    expect(up.to).toBeLessThan(down.to);
    expect(up.from).toBe(down.from); // низ луча приколот к узлу
  });
});

describe('бейдж типа — вид голограммы', () => {
  const look = badgeLook();

  it('ореол ШИРЕ капсулы — иначе это не свечение, а вторая окружность', () => {
    expect(look.glowRadius).toBeGreaterThan(BADGE_R);
  });

  it('внутреннее кольцо лежит ВНУТРИ ободка и тусклее его', () => {
    expect(look.scanInset).toBeGreaterThan(0);
    expect(look.scanInset).toBeLessThan(BADGE_R);
    expect(look.scanAlpha).toBeLessThan(look.rimAlpha);
  });

  it('КАПСУЛА ПРОЗРАЧНА: сквозь голограмму видно карту, иначе это наклейка', () => {
    expect(look.fillAlpha).toBeGreaterThan(0);
    expect(look.fillAlpha).toBeLessThan(0.5);
  });

  it('луч — самое тусклое во всей голограмме: он подсказка, а не линия карты', () => {
    expect(look.tetherAlpha).toBeLessThan(look.fillAlpha + look.rimAlpha);
    expect(look.tetherAlpha).toBeLessThan(look.rimAlpha);
    expect(look.tetherDash[0]).toBeGreaterThan(0);
    expect(look.tetherDash[1]).toBeGreaterThan(0);
  });

  it('знак типа — самое яркое: ради него весь ярус и существует', () => {
    expect(look.glyphAlpha).toBeGreaterThan(look.rimAlpha);
    expect(look.glyphAlpha).toBeGreaterThan(look.scanAlpha);
    expect(look.glyphAlpha).toBeGreaterThan(look.tetherAlpha);
  });

  it('вид стабилен', () => {
    expect(badgeLook()).toEqual(badgeLook());
  });
});

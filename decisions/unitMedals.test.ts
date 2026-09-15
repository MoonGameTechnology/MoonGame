/**
 * ЗНАЧКИ МЕДАЛЕЙ В СТРОКЕ СОСТАВА (VET-5) — приёмка решения.
 *
 * Проверяется КЛИЕНТСКАЯ половина: глиф, подпись, порядок и — важнее всего — что у стека
 * без заслуги вид не меняется вовсе. Правило «сколько заслуги на какую степень» здесь НЕ
 * проверяется: оно в ядре и покрыто там (`state/medals.test.ts`), а повторить проверку
 * значило бы завести вторую истину.
 */
import { describe, expect, it } from 'vitest';
import { medalBadges } from './unitMedals';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import { setLocale } from '../localization/core';
import '../localization/runtime';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  medals: { valour: { grades: [10, 20, 30, 40] }, service: { grades: [1, 2, 3, 4] } },
});

describe('VET-5 — значки медалей стека', () => {
  it('у стека БЕЗ заслуги значков нет — строка не меняется ни на пиксель', () => {
    expect(medalBadges({ unit: 'x', count: 3 }, data)).toEqual([]);
  });

  it('две линии — два разных глифа, чтобы различались до чтения', () => {
    const badges = medalBadges({ unit: 'x', count: 1, damageDealt: 20, battles: 2 }, data);
    expect(badges).toHaveLength(2);
    expect(new Set(badges.map((b) => b.glyph)).size).toBe(2);
  });

  it('подпись — ИМЯ степени, а не её номер', () => {
    setLocale('ru');
    const [badge] = medalBadges({ unit: 'x', count: 1, damageDealt: 30 }, data);
    expect(badge?.title).toBe('Доблесть: Багровая звезда');
    expect(badge?.title).not.toMatch(/\d/); // номера степени игрок видеть не должен
  });

  it('подпись переводится, а не прибита к русскому', () => {
    setLocale('en');
    const [badge] = medalBadges({ unit: 'x', count: 1, battles: 4 }, data);
    expect(badge?.title).toBe('Service: Unbroken Line');
    setLocale('ru');
  });

  it('порядок берётся у ЯДРА и не зависит от того, какая степень выше', () => {
    const lines = (s: { damageDealt?: number; battles?: number }): string[] =>
      medalBadges({ unit: 'x', count: 1, ...s }, data).map((b) => b.line);
    expect(lines({ damageDealt: 10, battles: 4 })).toEqual(['valour', 'service']);
    expect(lines({ damageDealt: 40, battles: 1 })).toEqual(['valour', 'service']);
  });
});

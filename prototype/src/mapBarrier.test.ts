import { describe, it, expect } from 'vitest';
import { isImpassableKind, SECTOR_TYPES } from './map';
import { data } from './gameData';

/**
 * MAP-BARRIER на стороне прототипа. Барьерная граница рисуется только там, где мир её
 * ОБЪЯСНЯЕТ — у непроходимого сектора (решение владельца 2026-09-18). Значит ответ на
 * «непроходим ли этот вид» обязан быть верным для ЛЮБОГО вида каталога, а не только для
 * тех, что перечислены в UI-таблице прототипа.
 */
describe('isImpassableKind — читает каталог, а не UI-таблицу', () => {
  it('чёрная дыра и разлом непроходимы', () => {
    expect(isImpassableKind('black_hole')).toBe(true);
    expect(isImpassableKind('rift')).toBe(true);
  });

  it('обычные виды проходимы', () => {
    for (const kind of ['planet', 'asteroid', 'nebula', 'empty', 'ion_storm']) {
      expect([kind, isImpassableKind(kind)]).toEqual([kind, false]);
    }
  });

  it('неизвестный и отсутствующий вид проходимы — разрешительный дефолт ядра', () => {
    expect(isImpassableKind(undefined)).toBe(false);
    expect(isImpassableKind('нет-такого-вида')).toBe(false);
  });

  it('ЛОВУШКА: `rift` отсутствует в SECTOR_TYPES, и спрашивать её было бы ошибкой', () => {
    // Таблица SECTOR_TYPES строится из фиксированного UI-списка, поэтому новый вид
    // каталога в неё не попадает. Наивная реализация через неё молча ответила бы
    // «проходим» — и барьер не нарисовался бы никогда.
    expect(SECTOR_TYPES['rift']).toBeUndefined();
    expect(data.sectorKinds['rift']?.traversable).toBe(false);
    expect(isImpassableKind('rift')).toBe(true);
  });
});

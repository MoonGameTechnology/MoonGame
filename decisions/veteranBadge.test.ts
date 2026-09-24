import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, t } from '../localization/runtime';
import { veteranBadge } from './veteranBadge';
import { medalBadges } from './unitMedals';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';

// Локаль пришпилена: в Node нет языка браузера, рантайм упал бы на EN и подписи поехали.
beforeAll(() => setLocale('ru'));

describe('значок надбавки ветерана (PERK-3.3)', () => {
  it('множитель превращается в проценты и в подпись', () => {
    const b = veteranBadge(1.16);
    expect(b?.percent).toBe(16);
    expect(b?.text).toBe('+16%');
    expect(b?.title).toBe(t('battle.win.veteran', { n: 16 }));
    expect(b?.title).not.toContain('{n}'); // подстановка сработала, а не уехала сырой
  });

  it('показывать нечего — null, а не «+0%»', () => {
    expect(veteranBadge(undefined)).toBeNull(); // надбавки нет
    expect(veteranBadge(1)).toBeNull(); // ровно единица — тоже «нет»
    // Округление в ноль. Это не придирка: типичная выслуга — один бой на юнит при
    // половине необстрелянных сил, так что 1.004 встречается чаще, чем 1.16.
    expect(veteranBadge(1.004)).toBeNull();
    // И защита от бессмыслицы: множитель меньше единицы надбавкой не является.
    expect(veteranBadge(0.9)).toBeNull();
  });

  it('округляет к ближайшему проценту, а не режет', () => {
    expect(veteranBadge(1.006)?.percent).toBe(1);
    expect(veteranBadge(1.014)?.percent).toBe(1);
    expect(veteranBadge(1.016)?.percent).toBe(2);
    // Ровно-половинные множители (1.005, 1.015) НЕ проверяются, и это не пропуск:
    // `(1.005 - 1) * 100` в double даёт 0.4999…, так что они падают вниз, а не вверх.
    // Пришпиливать этот порог значило бы закрепить артефакт представления чисел —
    // игроку разница между «ничего» и «+1%» на такой границе не видна в принципе.
  });

  it('глиф ТОТ ЖЕ, что у медали «Выслуга» в строке состава', () => {
    // Одна механика, показанная в двух местах. Разойдись глифы — игрок не связал бы
    // вымпел на корабле с процентами в окне боя, а связывать это его работа не должна.
    const data: GameData = parseGameData({
      version: '0.1.0',
      resources: ['metal'],
      units: {},
      factions: {},
      buildings: {},
      events: {},
      medals: { service: { grades: [1, 2, 3, 4] } },
    });
    const service = medalBadges({ unit: 'u', count: 1, battles: 2 }, data).find(
      (m) => m.line === 'service',
    );
    expect(service).toBeDefined();
    expect(veteranBadge(1.08)?.glyph).toBe(service!.glyph);
  });
});

// RECAP-FOG — сторож правила «сводка про МОЮ империю».
//
// Баг, который закрывает файл: журнал событий (он же источник `buildRecap` и пуша)
// принимал `building.constructed` / `building.upgraded` / `unit.built` БЕЗ проверки
// владельца, так что в мою сводку падала чужая экономика. Это раскрытие: контент
// чужих миров туман режет специально, а уведомление отдавало его текстом.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECAP_POLICY, recapAdmits } from './recapGate';

const ME = 'p1';
const FOE = 'p2';

describe('RECAP-FOG — чужая экономика в мою сводку не попадает', () => {
  it('стройка, улучшение и производство противника отсекаются ДАЖЕ на видимом мире', () => {
    for (const type of ['building.constructed', 'building.upgraded', 'unit.built']) {
      expect(recapAdmits(type, FOE, ME, true), type).toBe(false);
      expect(recapAdmits(type, FOE, ME, false), type).toBe(false);
    }
  });

  it('своё показывается всегда — даже если мир почему-то не опознан', () => {
    for (const type of Object.keys(RECAP_POLICY)) {
      expect(recapAdmits(type, ME, ME, false), type).toBe(true);
    }
  });

  it('события КАРТЫ (взрыв, вылет) видно у чужих — но только там, где вижу', () => {
    for (const type of ['building.destroyed', 'fleet.launched']) {
      expect(recapAdmits(type, FOE, ME, true), type).toBe(true);
      expect(recapAdmits(type, FOE, ME, false), type).toBe(false);
    }
  });

  it('fail-secure: событие без владельца — это НЕ моё', () => {
    expect(recapAdmits('unit.built', undefined, ME, true)).toBe(false);
    expect(recapAdmits('building.constructed', null, ME, true)).toBe(false);
    // а событие карты без владельца решается видимостью, а не угадыванием
    expect(recapAdmits('fleet.launched', undefined, ME, true)).toBe(true);
    expect(recapAdmits('fleet.launched', undefined, ME, false)).toBe(false);
  });

  it('незнакомый тип пропускается — у него своя логика видимости на месте вызова', () => {
    expect(recapAdmits('diplomacy.changed', FOE, ME, false)).toBe(true);
  });

  // Опись: правило работает, только пока КАЖДЫЙ leak-класс через него проходит. Если
  // кто-то заведёт новый `case 'building.*'`/`'unit.built'` в свитче событий и позовёт
  // `note()` напрямую, гейт обязан покраснеть — иначе утечка вернётся тихо, ровно так
  // же, как пришла.
  it('в main.ts каждый экономический case проходит через admits(), а не мимо', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    for (const type of Object.keys(RECAP_POLICY)) {
      const at = src.indexOf(`case '${type}':`);
      expect(at, type).toBeGreaterThan(-1);
      // тело case — до следующего `case ` — обязано начинаться с проверки
      const body = src.slice(at, src.indexOf("      case '", at + 10));
      expect(body.includes(`admits('${type}'`), type).toBe(true);
    }
  });
});

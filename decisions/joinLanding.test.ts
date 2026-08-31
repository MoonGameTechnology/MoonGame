import { describe, expect, it } from 'vitest';
import { joinLanding, type JoinAttempt } from './joinLanding';

const attempt = (over: Partial<JoinAttempt> = {}): JoinAttempt => ({
  authRequired: true,
  hasSession: false,
  refused: false,
  ...over,
});

describe('joinLanding (ADDR-5)', () => {
  it('ведёт в матч, когда сессия есть', () => {
    expect(joinLanding(attempt({ hasSession: true }))).toBe('match');
  });

  it('сервер без аккаунтов пускает по ссылке сразу, сессии не спрашивая (правило 4)', () => {
    expect(joinLanding(attempt({ authRequired: false, hasSession: false }))).toBe('match');
  });

  it('без сессии на сервере с аккаунтами сначала стартовый экран', () => {
    expect(joinLanding(attempt({ authRequired: true, hasSession: false }))).toBe('welcome');
  });

  // Правило 1 — главное: НИ ОДИН исход не оставляет игрока без экрана. Проверяем это
  // перебором всех восьми комбинаций, а не примерами: пустой экран возвращался бы как
  // отсутствие ветки, и точечный тест его бы не поймал.
  it('никогда не оставляет без видимого экрана — на всех входах (правило 1)', () => {
    const landings = new Set<string>();
    for (const authRequired of [false, true]) {
      for (const hasSession of [false, true]) {
        for (const refused of [false, true]) {
          const where = joinLanding({ authRequired, hasSession, refused });
          expect(['match', 'hub', 'welcome']).toContain(where);
          landings.add(where);
        }
      }
    }
    // И все три исхода достижимы — иначе «всегда welcome» тоже прошло бы проверку выше.
    expect(landings).toEqual(new Set(['match', 'hub', 'welcome']));
  });

  describe('отказ', () => {
    it('с живой сессией уводит в главное меню, а не на карточку входа', () => {
      expect(joinLanding(attempt({ hasSession: true, refused: true }))).toBe('hub');
    });

    it('без сессии уводит на стартовый экран', () => {
      expect(joinLanding(attempt({ hasSession: false, refused: true }))).toBe('welcome');
    });

    it('без сессии уводит на стартовый экран и на сервере без аккаунтов', () => {
      expect(joinLanding(attempt({ authRequired: false, refused: true }))).toBe('welcome');
    });

    // Правило 3: посадка не зависит от ПРИЧИНЫ отказа — код сюда не передаётся вовсе,
    // поэтому «матча нет» и «мест нет» неразличимы по тому, куда игрока увело.
    it('одинакова при любой причине — решает только сессия (правило 3)', () => {
      const withSession = joinLanding(attempt({ hasSession: true, refused: true }));
      const withoutSession = joinLanding(attempt({ hasSession: false, refused: true }));
      expect(withSession).toBe('hub');
      expect(withoutSession).toBe('welcome');
      // Отказ не может привести в матч ни при каких входных данных.
      for (const authRequired of [false, true]) {
        for (const hasSession of [false, true]) {
          expect(joinLanding({ authRequired, hasSession, refused: true })).not.toBe('match');
        }
      }
    });
  });
});

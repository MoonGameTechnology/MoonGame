import { describe, expect, it } from 'vitest';
import { joinLanding, type JoinAttempt, type ServerIdentity } from './joinLanding';

const attempt = (over: Partial<JoinAttempt> = {}): JoinAttempt => ({
  identity: 'accounts',
  hasSession: false,
  refused: false,
  ...over,
});

const IDENTITIES: ServerIdentity[] = ['accounts', 'nicks', 'unknown'];

describe('joinLanding (ADDR-5)', () => {
  it('ведёт в матч, когда сессия есть', () => {
    expect(joinLanding(attempt({ hasSession: true }))).toBe('match');
  });

  it('сервер без аккаунтов пускает по ссылке сразу, сессии не спрашивая (правило 4)', () => {
    expect(joinLanding(attempt({ identity: 'nicks', hasSession: false }))).toBe('match');
  });

  it('без сессии на сервере с аккаунтами сначала стартовый экран', () => {
    expect(joinLanding(attempt({ identity: 'accounts', hasSession: false }))).toBe('welcome');
  });

  // РЕГРЕСС. Это и есть тот баг: посторонний из чистого браузера открывал ссылку на
  // партию и уезжал на карту. Дверь ему сервер не открывал (рукопожатие отказывает тому,
  // у кого нет места), но игра успевала показать карту и вела себя как со своим. Причина
  // была не здесь, а во ВХОДЕ: «пробу не спросили / не дошла» приходило сюда тем же
  // значением, что и честное «аккаунтов нет», — и правило 4 срабатывало на незнании.
  it('НЕ пускает по незнанию: «не спросили» — это не «аккаунтов нет» (правило 5)', () => {
    expect(joinLanding(attempt({ identity: 'unknown', hasSession: false }))).toBe('welcome');
  });

  it('но своего с живой сессией незнание не запирает', () => {
    expect(joinLanding(attempt({ identity: 'unknown', hasSession: true }))).toBe('match');
  });

  // Общая форма того же: без сессии в матч ведёт РОВНО ОДИН ответ сервера — «аккаунтов
  // у меня нет». Перебор держит правило целиком, а не на одном примере: появится
  // четвёртое значение — и оно по умолчанию окажется закрытым, а не открытым.
  it('без сессии в матч пускает только честное «аккаунтов нет»', () => {
    for (const identity of IDENTITIES) {
      const where = joinLanding(attempt({ identity, hasSession: false }));
      expect(where).toBe(identity === 'nicks' ? 'match' : 'welcome');
    }
  });

  // Правило 1 — главное: НИ ОДИН исход не оставляет игрока без экрана. Проверяем это
  // перебором всех восьми комбинаций, а не примерами: пустой экран возвращался бы как
  // отсутствие ветки, и точечный тест его бы не поймал.
  it('никогда не оставляет без видимого экрана — на всех входах (правило 1)', () => {
    const landings = new Set<string>();
    for (const identity of IDENTITIES) {
      for (const hasSession of [false, true]) {
        for (const refused of [false, true]) {
          const where = joinLanding({ identity, hasSession, refused });
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
      expect(joinLanding(attempt({ identity: 'nicks', refused: true }))).toBe('welcome');
    });

    // Правило 3: посадка не зависит от ПРИЧИНЫ отказа — код сюда не передаётся вовсе,
    // поэтому «матча нет» и «мест нет» неразличимы по тому, куда игрока увело.
    it('одинакова при любой причине — решает только сессия (правило 3)', () => {
      const withSession = joinLanding(attempt({ hasSession: true, refused: true }));
      const withoutSession = joinLanding(attempt({ hasSession: false, refused: true }));
      expect(withSession).toBe('hub');
      expect(withoutSession).toBe('welcome');
      // Отказ не может привести в матч ни при каких входных данных.
      for (const identity of IDENTITIES) {
        for (const hasSession of [false, true]) {
          expect(joinLanding({ identity, hasSession, refused: true })).not.toBe('match');
        }
      }
    });
  });
});

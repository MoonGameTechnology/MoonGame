import { describe, expect, it } from 'vitest';
import { seatClaim, type JoinSeatInput } from './joinSeat';

const KNOWN = ['azure', 'crimson', 'amber'] as const;
const input = (over: Partial<JoinSeatInput> = {}): JoinSeatInput => ({
  knownFactions: KNOWN,
  ...over,
});
const fresh = (playerId = 'p1'): JoinSeatInput['resolved'] => ({ playerId, isNew: true });
const returning = (playerId = 'p1'): JoinSeatInput['resolved'] => ({ playerId, isNew: false });

describe('seatClaim (ENTRY-1/ENTRY-3)', () => {
  it('сажает на место, которое вернул резолвер', () => {
    expect(seatClaim(input({ resolved: fresh('p3') }))).toEqual({
      ok: true,
      playerId: 'p3',
      claim: {},
    });
  });

  it('несёт выбранный дом в заявку', () => {
    expect(seatClaim(input({ resolved: fresh('p2'), preferredFaction: 'azure' }))).toEqual({
      ok: true,
      playerId: 'p2',
      claim: { faction: 'azure' },
    });
  });

  it('на возврате в свой матч заявки нет — место уже заявлено (правило 2)', () => {
    expect(seatClaim(input({ resolved: returning('p2'), preferredFaction: 'crimson' }))).toEqual({
      ok: true,
      playerId: 'p2',
      claim: null,
    });
  });

  it('без свободного места — отказ, а не «посадим куда-нибудь» (правило 3)', () => {
    expect(seatClaim(input({ resolved: null, preferredFaction: 'azure' }))).toEqual({
      ok: false,
      code: 'E_MATCH_FULL',
    });
    expect(seatClaim(input())).toEqual({ ok: false, code: 'E_MATCH_FULL' });
  });

  describe('правило 5 — заявка подаётся и без выбора', () => {
    it('новый захват без дома всё равно даёт заявку: она замок, а не запись выбора', () => {
      expect(seatClaim(input({ resolved: fresh() }))).toEqual({
        ok: true,
        playerId: 'p1',
        claim: {},
      });
    });

    it('пустая строка дома — тоже «не выбирал», но заявка есть', () => {
      expect(seatClaim(input({ resolved: fresh(), preferredFaction: '' }))).toEqual({
        ok: true,
        playerId: 'p1',
        claim: {},
      });
    });
  });

  describe('AvA (правило 1)', () => {
    it('место берётся из ростера, резолвер не спрашивается', () => {
      expect(seatClaim(input({ avaPlayerId: 'p5', resolved: fresh() }))).toEqual({
        ok: true,
        playerId: 'p5',
        claim: {},
      });
    });

    it('выбор дома не применяется — заявка пустая, решает ростер', () => {
      expect(seatClaim(input({ avaPlayerId: 'p5', preferredFaction: 'azure' }))).toEqual({
        ok: true,
        playerId: 'p5',
        claim: {},
      });
    });

    it('неизвестный дом на AvA-месте не мешает войти — он там и не применяется', () => {
      expect(seatClaim(input({ avaPlayerId: 'p7', preferredFaction: 'not-a-house' }))).toEqual({
        ok: true,
        playerId: 'p7',
        claim: {},
      });
    });
  });

  describe('каталог домов (правило 4)', () => {
    it('неизвестный дом — отказ, а не тихая посадка с домом по умолчанию', () => {
      expect(seatClaim(input({ resolved: fresh(), preferredFaction: 'not-a-house' }))).toEqual({
        ok: false,
        code: 'E_UNKNOWN_FACTION',
      });
    });

    it('пустой каталог отвергает любой выбор — fail-secure, а не «раз списка нет, пускаем всё»', () => {
      expect(
        seatClaim({ knownFactions: [], resolved: fresh(), preferredFaction: 'azure' }),
      ).toEqual({ ok: false, code: 'E_UNKNOWN_FACTION' });
    });

    // Вторая половина правила 4: сверяем ТОЛЬКО там, где дом применяется. Иначе стухший
    // `&faction=` в закладке запирал бы игрока в его же матче.
    it('на возврате неизвестный дом не запирает вход', () => {
      expect(
        seatClaim(input({ resolved: returning('p2'), preferredFaction: 'not-a-house' })),
      ).toEqual({ ok: true, playerId: 'p2', claim: null });
    });
  });

  // Тот самый баг, ради которого модуль и заведён: реализация принимала три параметра
  // вместо пяти и молча теряла `faction`. Проверяем НАБЛЮДАЕМОЕ следствие — что выбор
  // игрока доходит до решения. Две попытки отличаются ровно наличием `faction`.
  it('выбор дома не теряется по дороге — пришёл, значит учтён', () => {
    expect(seatClaim(input({ resolved: fresh() }))).toEqual({
      ok: true,
      playerId: 'p1',
      claim: {},
    });
    expect(seatClaim(input({ resolved: fresh(), preferredFaction: 'azure' }))).toEqual({
      ok: true,
      playerId: 'p1',
      claim: { faction: 'azure' },
    });
  });
});

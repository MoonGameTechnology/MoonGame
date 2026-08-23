import { describe, expect, it } from 'vitest';
import { seatClaim, type JoinSeatInput } from './joinSeat';

const KNOWN = ['azure', 'crimson', 'amber'] as const;
const input = (over: Partial<JoinSeatInput> = {}): JoinSeatInput => ({
  knownFactions: KNOWN,
  ...over,
});

describe('seatClaim (ENTRY-1)', () => {
  it('сажает на место, которое вернул резолвер', () => {
    expect(seatClaim(input({ resolved: { playerId: 'p3', isNew: true } }))).toEqual({
      ok: true,
      playerId: 'p3',
      applyFaction: false,
    });
  });

  it('переписывает дом на первом захвате, когда игрок его выбрал', () => {
    expect(
      seatClaim(input({ resolved: { playerId: 'p2', isNew: true }, preferredFaction: 'azure' })),
    ).toEqual({ ok: true, playerId: 'p2', applyFaction: true });
  });

  it('НЕ переписывает дом на возврате в свой матч (правило 2)', () => {
    expect(
      seatClaim(input({ resolved: { playerId: 'p2', isNew: false }, preferredFaction: 'crimson' })),
    ).toEqual({ ok: true, playerId: 'p2', applyFaction: false });
  });

  it('без свободного места — отказ, а не «посадим куда-нибудь» (правило 3)', () => {
    expect(seatClaim(input({ resolved: null, preferredFaction: 'azure' }))).toEqual({
      ok: false,
      code: 'E_MATCH_FULL',
    });
    expect(seatClaim(input())).toEqual({ ok: false, code: 'E_MATCH_FULL' });
  });

  describe('AvA (правило 1)', () => {
    it('место берётся из ростера, резолвер не спрашивается', () => {
      expect(
        seatClaim(input({ avaPlayerId: 'p5', resolved: { playerId: 'p1', isNew: true } })),
      ).toEqual({ ok: true, playerId: 'p5', applyFaction: false });
    });

    it('выбор дома игроком не применяется даже на первом захвате', () => {
      expect(seatClaim(input({ avaPlayerId: 'p5', preferredFaction: 'azure' }))).toEqual({
        ok: true,
        playerId: 'p5',
        applyFaction: false,
      });
    });
  });

  describe('каталог домов (правило 4)', () => {
    it('неизвестный дом — отказ, а не тихая посадка с домом по умолчанию', () => {
      expect(
        seatClaim(
          input({ resolved: { playerId: 'p1', isNew: true }, preferredFaction: 'not-a-house' }),
        ),
      ).toEqual({ ok: false, code: 'E_UNKNOWN_FACTION' });
    });

    it('пустой каталог отвергает любой выбор — fail-secure, а не «раз списка нет, пускаем всё»', () => {
      expect(
        seatClaim({
          knownFactions: [],
          resolved: { playerId: 'p1', isNew: true },
          preferredFaction: 'azure',
        }),
      ).toEqual({ ok: false, code: 'E_UNKNOWN_FACTION' });
    });

    // Правило 4, вторая половина: сверяем ТОЛЬКО там, где дом применяется. Иначе
    // стухший `&faction=` в закладке запирал бы игрока в его же матче.
    it('на возврате неизвестный дом не запирает вход — он там и так игнорируется', () => {
      expect(
        seatClaim(
          input({ resolved: { playerId: 'p2', isNew: false }, preferredFaction: 'not-a-house' }),
        ),
      ).toEqual({ ok: true, playerId: 'p2', applyFaction: false });
    });

    it('на AvA-месте неизвестный дом тоже не мешает — ростер решает, выбор не применяется', () => {
      expect(seatClaim(input({ avaPlayerId: 'p7', preferredFaction: 'not-a-house' }))).toEqual({
        ok: true,
        playerId: 'p7',
        applyFaction: false,
      });
    });
  });

  // Тот самый баг, ради которого модуль и заведён: реализация принимала три параметра
  // вместо пяти и молча теряла `faction`. Проверяем НАБЛЮДАЕМОЕ следствие — что выбор
  // игрока вообще доходит до решения. Happy-path тест выше этого не ловит: он проходит
  // и тогда, когда поле просто не читают, если ожидание тоже false.
  it('выбор дома не теряется по дороге — пришёл, значит учтён', () => {
    const seat = { playerId: 'p1', isNew: true };
    const ignored = seatClaim(input({ resolved: seat }));
    const honoured = seatClaim(input({ resolved: seat, preferredFaction: 'azure' }));
    expect(ignored).toEqual({ ok: true, playerId: 'p1', applyFaction: false });
    expect(honoured).toEqual({ ok: true, playerId: 'p1', applyFaction: true });
    // Единственная разница во входе — наличие faction; значит именно он и решает.
  });

  it('пустая строка дома не считается выбором', () => {
    const r = seatClaim(input({ resolved: { playerId: 'p1', isNew: true }, preferredFaction: '' }));
    expect(r).toEqual({ ok: true, playerId: 'p1', applyFaction: false });
  });
});

import { describe, expect, it } from 'vitest';
import { seatClaim } from './joinSeat';

describe('seatClaim (ENTRY-1)', () => {
  it('сажает на место, которое вернул резолвер', () => {
    expect(seatClaim({ resolved: { playerId: 'p3', isNew: true } })).toEqual({
      playerId: 'p3',
      applyFaction: false,
    });
  });

  it('переписывает дом на первом захвате, когда игрок его выбрал', () => {
    expect(
      seatClaim({ resolved: { playerId: 'p2', isNew: true }, preferredFaction: 'azure' }),
    ).toEqual({ playerId: 'p2', applyFaction: true });
  });

  it('НЕ переписывает дом на возврате в свой матч (правило 2)', () => {
    expect(
      seatClaim({ resolved: { playerId: 'p2', isNew: false }, preferredFaction: 'crimson' }),
    ).toEqual({ playerId: 'p2', applyFaction: false });
  });

  it('без свободного места — отказ, а не «посадим куда-нибудь» (правило 3)', () => {
    expect(seatClaim({ resolved: null, preferredFaction: 'azure' })).toBeNull();
    expect(seatClaim({})).toBeNull();
  });

  describe('AvA (правило 1)', () => {
    it('место берётся из ростера, резолвер не спрашивается', () => {
      expect(
        seatClaim({ avaPlayerId: 'p5', resolved: { playerId: 'p1', isNew: true } }),
      ).toEqual({ playerId: 'p5', applyFaction: false });
    });

    it('выбор дома игроком не применяется даже на первом захвате', () => {
      expect(seatClaim({ avaPlayerId: 'p5', preferredFaction: 'azure' })).toEqual({
        playerId: 'p5',
        applyFaction: false,
      });
    });
  });

  // Тот самый баг, ради которого модуль и заведён: реализация принимала три параметра
  // вместо пяти и молча теряла `faction`. Проверяем НАБЛЮДАЕМОЕ следствие — что выбор
  // игрока вообще доходит до решения. Happy-path тест выше этого не ловит: он проходит
  // и тогда, когда поле просто не читают, если ожидание тоже false.
  it('выбор дома не теряется по дороге — пришёл, значит учтён', () => {
    const ignored = seatClaim({ resolved: { playerId: 'p1', isNew: true } });
    const honoured = seatClaim({
      resolved: { playerId: 'p1', isNew: true },
      preferredFaction: 'azure',
    });
    expect(ignored?.applyFaction).toBe(false);
    expect(honoured?.applyFaction).toBe(true);
    // Единственная разница во входе — наличие faction; значит именно он и решает.
  });

  it('пустая строка дома не считается выбором', () => {
    expect(
      seatClaim({ resolved: { playerId: 'p1', isNew: true }, preferredFaction: '' })?.applyFaction,
    ).toBe(false);
  });
});

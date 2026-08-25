import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Player } from '@void/shared-core';
import { SEAT_CLAIM_WINDOW_MS, expiredSeatClaims } from './seatExpiry';

const HOUR = 60 * 60 * 1000;

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  name: id,
  faction: 'azure',
  status: 'active',
  resources: {},
  ...over,
});

/** Мир, где игровое время ушло на `gameElapsed` от момента заявки (заявка в нуле). */
function world(gameElapsed: number, seats: Record<string, Partial<Player>>): GameState {
  const base = createInitialState({ seed: 'expiry', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const [id, over] of Object.entries(seats)) players[id] = player(id, over);
  return { ...base, time: gameElapsed, players };
}

const ids = (r: ReturnType<typeof expiredSeatClaims>): string[] => r.map((x) => x.playerId);

describe('expiredSeatClaims (ENTRY-3, правило 7)', () => {
  it('незаявленное место не трогает', () => {
    const s = world(100 * SEAT_CLAIM_WINDOW_MS, { p1: {} });
    expect(expiredSeatClaims(s, 1)).toEqual([]);
  });

  it('свежую заявку не трогает', () => {
    const s = world(HOUR, { p1: { claimedAt: 0 } });
    expect(expiredSeatClaims(s, 1)).toEqual([]);
  });

  it('просроченную отпускает', () => {
    const s = world(25 * HOUR, { p1: { claimedAt: 0 } });
    expect(ids(expiredSeatClaims(s, 1))).toEqual(['p1']);
  });

  describe('правило 1 — окно РЕАЛЬНОЕ, а не игровое', () => {
    it('на ×100 игровые сутки — это ещё не сутки реальных', () => {
      const s = world(25 * HOUR, { p1: { claimedAt: 0 } });
      expect(expiredSeatClaims(s, 100)).toEqual([]);
    });

    it('на ×100 отпускает только когда прошли реальные сутки', () => {
      const s = world(100 * 25 * HOUR, { p1: { claimedAt: 0 } });
      expect(ids(expiredSeatClaims(s, 100))).toEqual(['p1']);
    });

    it('бессмысленная шкала не отпускает все места разом', () => {
      const s = world(HOUR, { p1: { claimedAt: 0 } });
      expect(expiredSeatClaims(s, 0)).toEqual([]);
    });
  });

  describe('правило 2 — закреплённое место не отзывается', () => {
    it('дошедшего до карты не трогает, сколько бы ни прошло', () => {
      const s = world(1000 * SEAT_CLAIM_WINDOW_MS, { p1: { claimedAt: 0, seated: true } });
      expect(expiredSeatClaims(s, 1)).toEqual([]);
    });
  });

  describe('правило 3 — граница не отпускает', () => {
    it('ровно окно — держим', () => {
      const s = world(SEAT_CLAIM_WINDOW_MS, { p1: { claimedAt: 0 } });
      expect(expiredSeatClaims(s, 1)).toEqual([]);
    });

    it('на миллисекунду больше — отпускаем', () => {
      const s = world(SEAT_CLAIM_WINDOW_MS + 1, { p1: { claimedAt: 0 } });
      expect(ids(expiredSeatClaims(s, 1))).toEqual(['p1']);
    });
  });

  describe('правило 4 — порядок стабилен', () => {
    it('места идут по идентификатору, а не по обходу ключей', () => {
      const s = world(25 * HOUR, {
        p3: { claimedAt: 0 },
        p1: { claimedAt: 0 },
        p2: { claimedAt: 0, seated: true },
      });
      expect(ids(expiredSeatClaims(s, 1))).toEqual(['p1', 'p3']);
    });
  });

  it('идентификатор действия несёт момент заявки — вторая заявка не сдедупится как повтор', () => {
    const first = expiredSeatClaims(world(25 * HOUR, { p1: { claimedAt: 0 } }), 1)[0];
    const second = expiredSeatClaims(world(50 * HOUR, { p1: { claimedAt: HOUR } }), 1)[0];
    expect(first?.action.id).not.toBe(second?.action.id);
  });

  it('действие адресовано своему месту и не несёт payload', () => {
    const [only] = expiredSeatClaims(world(25 * HOUR, { p1: { claimedAt: 0 } }), 1);
    expect(only?.action.type).toBe('seat.release');
    expect(only?.action.playerId).toBe('p1');
    expect(only?.action.payload).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { defectorCards, defectorNews } from './spyDefector';
import type { GameState } from '../packages/shared-core/src/index';

const offer = (id: number, until: number, xp?: number) => ({
  id,
  from: 'p1',
  planetId: 'B',
  kind: 'theft',
  at: 0,
  until,
  ...(xp ? { xp } : {}),
});
const world = (offers: ReturnType<typeof offer>[]) =>
  ({ spyOffers: { me: offers, other: [offer(9, 1)] } }) as unknown as GameState;

describe('перебежчик — карточки окна', () => {
  it('правило 1: нет предложений — нет карточек, чужие не видны', () => {
    expect(defectorCards({} as GameState, 'me', 0)).toEqual([]);
    expect(defectorCards(world([]), 'me', 0)).toEqual([]);
  });

  it('правило 2: первым тот, кто сбежит раньше; при равенстве — меньший номер', () => {
    const cards = defectorCards(world([offer(3, 500), offer(2, 100), offer(1, 500)]), 'me', 0);
    expect(cards.map((c) => c.offerId)).toEqual([2, 1, 3]);
  });

  it('правило 3: опыт и остаток — числа; срок вышел — ноль, а не минус', () => {
    expect(defectorCards(world([offer(1, 100, 3.5)]), 'me', 40)).toEqual([
      { offerId: 1, from: 'p1', planetId: 'B', xp: 3.5, level: 2, leftMs: 60 },
    ]);
    expect(defectorCards(world([offer(1, 100)]), 'me', 200)[0]).toMatchObject({ xp: 0, level: 0, leftMs: 0 });
  });
});

describe('перебежчик — строка журнала (правило 4)', () => {
  const p = (extra: Record<string, unknown> = {}) => ({ owner: 'me', from: 'p1', ...extra });
  it('просьба — без тоста, принят и сбежал — с тостом', () => {
    expect(defectorNews('espionage.defector', p(), 'me')).toEqual({
      key: 'log.spy.defector',
      from: 'p1',
      quiet: true,
    });
    expect(defectorNews('espionage.defector.joined', p(), 'me')).toMatchObject({
      key: 'log.spy.defector.joined',
      quiet: false,
    });
    expect(defectorNews('espionage.defector.fled', p(), 'me')?.key).toBe('log.spy.defector.fled');
    expect(defectorNews('espionage.defector.fled', p({ expired: true }), 'me')?.key).toBe(
      'log.spy.defector.expired',
    );
  });
  it('чужое и постороннее — не строка', () => {
    expect(defectorNews('espionage.defector', p(), 'other')).toBeNull();
    expect(defectorNews('espionage.detected', p(), 'me')).toBeNull();
    expect(defectorNews('espionage.defector', { owner: 'me' }, 'me')).toBeNull();
  });
});

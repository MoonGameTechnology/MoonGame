import { describe, expect, it } from 'vitest';
import { pickHoldFleet, type HoldCandidate } from './holdPick';

const c = (id: string, over: Partial<HoldCandidate> = {}): HoldCandidate => ({
  id,
  carrier: false,
  repair: 0,
  room: 5,
  ...over,
});

describe('pickHoldFleet — в чей трюм грузить эскадру (SHU-5.6)', () => {
  it('авианосец впереди всех, даже с меньшим трюмом и без ремонта', () => {
    const got = pickHoldFleet([
      c('a', { room: 5, repair: 0.05 }),
      c('b', { carrier: true, room: 2 }),
    ]);
    expect(got?.id).toBe('b');
  });

  it('без авианосца — флот с ремонтным ангаром, а не самый просторный', () => {
    const got = pickHoldFleet([c('a', { room: 16 }), c('b', { room: 3, repair: 0.05 })]);
    expect(got?.id).toBe('b');
  });

  it('при равном ремонте — больше свободных мест, потом id', () => {
    expect(pickHoldFleet([c('a', { room: 2 }), c('b', { room: 4 })])?.id).toBe('b');
    expect(pickHoldFleet([c('b'), c('a')])?.id).toBe('a');
  });

  it('кандидатов нет — грузить некуда', () => {
    expect(pickHoldFleet([])).toBeUndefined();
  });

  it('вход не переставляется', () => {
    const xs = [c('b'), c('a')];
    pickHoldFleet(xs);
    expect(xs.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

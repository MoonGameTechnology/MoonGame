import { describe, expect, it } from 'vitest';
import { callsignIndex, SPY_SLOTS, spyRoster, type SpyRecordView } from './spyRoster';

const spy = (over: Partial<SpyRecordView>): SpyRecordView => ({ id: 1, state: 'rest', location: 'cap', ...over });

describe('spyRoster — список шпионов вкладки «Шпионаж»', () => {
  it('правило 1: «Дать задание» свободному, «Отменить» занятому, ничего — возвращающемуся, вербуемому и залёгшему на дно', () => {
    const rows = spyRoster([
      spy({ id: 1, state: 'rest' }),
      spy({ id: 2, state: 'wait', location: 'w' }),
      spy({ id: 3, state: 'travel', op: 'recon', arrivesAt: 50 }),
      spy({ id: 4, state: 'work', op: 'theft', arrivesAt: 90 }),
      spy({ id: 5, state: 'return', arrivesAt: 70 }),
      spy({ id: 6, state: 'recruit', arrivesAt: 80 }),
      spy({ id: 7, state: 'hidden', location: 'w', op: 'recon', arrivesAt: 99 }),
    ]);
    expect(rows.map((r) => r.action)).toEqual(['assign', 'assign', 'cancel', 'cancel', null, null, null]);
    expect(rows[6]).toMatchObject({ until: null, task: null });
  });

  it('правило 2: пост до отзыва идёт без таймера, путь и вербовка — с ним', () => {
    const [post, trip, recruit] = spyRoster([
      spy({ id: 1, state: 'work', op: 'counter', arrivesAt: Number.MAX_SAFE_INTEGER }),
      spy({ id: 2, state: 'travel', op: 'relocate', arrivesAt: 40 }),
      spy({ id: 3, state: 'recruit', arrivesAt: 60 }),
    ]);
    expect(post!.until).toBeNull();
    expect(post!.task).toBe('counter');
    expect(trip!.until).toBe(40);
    expect(recruit!.until).toBe(60);
    expect(recruit!.task).toBeNull();
  });

  it('правило 3: у живых шпионов позывные разные, новичок получает новый', () => {
    for (let g = 0; g < 6; g++) {
      const live = new Set<number>();
      for (let id = 1; id <= SPY_SLOTS; id++) live.add(callsignIndex(id, (id * g) % 5));
      expect(live.size).toBe(SPY_SLOTS);
    }
    expect(callsignIndex(2, 1)).not.toBe(callsignIndex(2, 0));
  });

  it('правило 4: строки идут по номеру', () => {
    const rows = spyRoster([spy({ id: 3 }), spy({ id: 1 }), spy({ id: 2 })]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('нет записи — пустой список', () => {
    expect(spyRoster(undefined)).toEqual([]);
  });
});

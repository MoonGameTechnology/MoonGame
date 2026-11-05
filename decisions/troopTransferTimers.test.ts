import { describe, expect, it } from 'vitest';
import type { Fleet } from '../packages/shared-core/src/index';
import { troopTransferTimers } from './troopTransferTimers';

const HOUR = 3_600_000;
const fleet = (extra: Partial<Fleet> = {}): Fleet => ({
  id: 'carrier',
  owner: 'p1',
  location: 'earth',
  movement: null,
  units: [],
  traits: [],
  ...extra,
});
const load = (doneAt = HOUR, from = 'earth') => ({
  unit: 'militia',
  count: 2,
  from,
  startAt: 0,
  doneAt,
});
const unload = (doneAt = HOUR, to = 'earth') => ({
  unit: 'militia',
  count: 2,
  to,
  startAt: 0,
  doneAt,
});

describe('погрузка и высадка — таймеры над объектами карты', () => {
  it('источник погрузки и цель высадки берутся из действующих заявок', () => {
    const fleets = [
      fleet({ loading: [load()] }),
      fleet({ id: 'reinforcement', location: 'fortress', unloading: [unload(HOUR, 'fortress')] }),
    ];
    expect(troopTransferTimers(fleets, 'p1', 60_000)).toEqual([
      {
        target: 'earth',
        rows: [{ kind: 'load', fleets: 1, leftMs: HOUR - 60_000, progress: 1 / 60 }],
      },
      {
        target: 'fortress',
        rows: [{ kind: 'unload', fleets: 1, leftMs: HOUR - 60_000, progress: 1 / 60 }],
      },
    ]);
  });

  it('время до конца всей группы; два типа войск одного флота считаются одним флотом', () => {
    const fleets = [
      fleet({ loading: [load(HOUR / 2), { ...load(HOUR), unit: 'tank' }] }),
      fleet({ id: 'second', loading: [load(2 * HOUR)] }),
    ];
    expect(troopTransferTimers(fleets, 'p1', HOUR / 4)).toEqual([
      {
        target: 'earth',
        rows: [{ kind: 'load', fleets: 2, leftMs: 1.75 * HOUR, progress: 0.125 }],
      },
    ]);
  });

  it('погрузка, выгрузка и штурм у одного мира идут отдельными строками в постоянном порядке', () => {
    const fleets = [
      fleet({
        id: 'assault',
        assaultLanding: { planetId: 'earth', startAt: 0, doneAt: 1.5 * HOUR },
      }),
      fleet({ id: 'unloader', unloading: [unload()] }),
      fleet({ loading: [load()] }),
    ];
    expect(troopTransferTimers(fleets, 'p1', 0)[0]!.rows).toEqual([
      { kind: 'load', fleets: 1, leftMs: HOUR, progress: 0 },
      { kind: 'unload', fleets: 1, leftMs: HOUR, progress: 0 },
      { kind: 'assault', fleets: 1, leftMs: 1.5 * HOUR, progress: 0 },
    ]);
  });

  it('чужие перевозки не раскрываются даже при полном мире соло', () => {
    const fleets = [
      fleet({
        owner: 'p2',
        loading: [load()],
        unloading: [unload()],
        assaultLanding: { planetId: 'earth', startAt: 0, doneAt: HOUR },
      }),
    ];
    expect(troopTransferTimers(fleets, 'p1', 0)).toEqual([]);
    expect(troopTransferTimers(fleets, 'p2', 0)[0]!.rows).toHaveLength(3);
  });

  it('истёкшая заявка показывает ноль до ответа мира, а завершённая или отменённая исчезает', () => {
    expect(
      troopTransferTimers([fleet({ loading: [load()] })], 'p1', 2 * HOUR)[0]!.rows[0]!.leftMs,
    ).toBe(0);
    expect(troopTransferTimers([fleet({ loading: [], unloading: [] })], 'p1', 2 * HOUR)).toEqual(
      [],
    );
    expect(troopTransferTimers([], 'p1', 0)).toEqual([]);
  });

  it('улетевший или переведённый к другому объекту флот не оставляет старый таймер', () => {
    for (const location of [null, 'mars']) {
      expect(
        troopTransferTimers(
          [
            fleet({
              location,
              loading: [load()],
              unloading: [unload()],
              assaultLanding: { planetId: 'earth', startAt: 0, doneAt: HOUR },
            }),
          ],
          'p1',
          0,
        ),
      ).toEqual([]);
    }
  });

  it('отсчёт идёт по часам мира, входные заявки не меняются', () => {
    const fleets = [fleet({ loading: [load()], unloading: [unload()] })];
    const before = structuredClone(fleets);
    expect(troopTransferTimers(fleets, 'p1', 0)[0]!.rows[0]!.leftMs).toBe(HOUR);
    expect(troopTransferTimers(fleets, 'p1', HOUR / 2)[0]!.rows[0]!.leftMs).toBe(HOUR / 2);
    expect(fleets).toEqual(before);
  });

  it('доля пройденного — от начала первой заявки группы до конца последней, как и отсчёт', () => {
    const fleets = [
      fleet({ assaultLanding: { planetId: 'earth', startAt: 0, doneAt: HOUR } }),
      fleet({
        id: 'late',
        assaultLanding: { planetId: 'earth', startAt: HOUR / 2, doneAt: 2 * HOUR },
      }),
    ];
    const row = (now: number) => troopTransferTimers(fleets, 'p1', now)[0]!.rows[0]!;
    expect(row(0).progress).toBe(0);
    expect(row(HOUR).progress).toBe(0.5);
    expect(row(HOUR).leftMs).toBe(HOUR);
    // Срок вышел, мир ещё не ответил: полоса полная, отсчёт на нуле.
    expect(row(3 * HOUR)).toMatchObject({ progress: 1, leftMs: 0 });
    // Заявка с нулевым окном не делит на ноль.
    const instant = [fleet({ loading: [{ ...load(0), startAt: 0 }] })];
    expect(troopTransferTimers(instant, 'p1', 0)[0]!.rows[0]!.progress).toBe(1);
  });
});

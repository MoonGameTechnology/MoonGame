import { describe, expect, it } from 'vitest';
import { afterLoadSteps, isLoadingBusy, splitByLoading } from './loadingOrders';

describe('loadingOrders — приказ флоту с идущей погрузкой', () => {
  it('занят тот, у кого есть погрузка или выгрузка (правило 1)', () => {
    expect(isLoadingBusy({ id: 'a' })).toBe(false);
    expect(isLoadingBusy({ id: 'a', loading: [] })).toBe(false);
    expect(isLoadingBusy({ id: 'a', loading: [{ doneAt: 5 }] })).toBe(true);
    expect(isLoadingBusy({ id: 'a', unloading: [{ doneAt: 5 }] })).toBe(true);
  });

  it('свободные уходят сразу, ждать — по самой поздней заявке (правила 2, 6)', () => {
    const r = splitByLoading(
      [
        { id: 'a', loading: [{ doneAt: 60_000 }] },
        { id: 'b' },
        { id: 'c', unloading: [{ doneAt: 30 * 60_000 + 1 }] },
      ],
      0,
    );
    expect(r).toEqual({ busy: ['a', 'c'], free: ['b'], minutesLeft: 31, landing: false });
  });

  it('высадка штурмом — тоже заявка: окно спросит и скажет о высадке (правило 7)', () => {
    expect(isLoadingBusy({ id: 'a', assaultLanding: { doneAt: 5 } })).toBe(true);
    const r = splitByLoading(
      [
        { id: 'a', loading: [{ doneAt: 10 * 60_000 }] },
        { id: 'b', assaultLanding: { doneAt: 90 * 60_000 } },
        { id: 'c' },
      ],
      0,
    );
    expect(r).toEqual({ busy: ['a', 'b'], free: ['c'], minutesLeft: 90, landing: true });
    expect(splitByLoading([{ id: 'a', loading: [{ doneAt: 5 }] }], 0).landing).toBe(false);
  });

  it('окно не обещает «0 мин», пока заявка не снята', () => {
    expect(splitByLoading([{ id: 'a', loading: [{ doneAt: 100 }] }], 100).minutesLeft).toBe(1);
    expect(splitByLoading([{ id: 'a' }], 0).minutesLeft).toBe(0);
  });

  it('отложенный приказ встаёт ПЕРЕД планом и режется по пределу (правила 3–4)', () => {
    expect(afterLoadSteps({ kind: 'move', to: 'X' }, [{ kind: 'wait', hours: 2 }], 8)).toEqual([
      { kind: 'move', to: 'X' },
      { kind: 'wait', hours: 2 },
    ]);
    expect(afterLoadSteps({ kind: 'assault', to: 'X' }, [], 8)).toEqual([
      { kind: 'move', to: 'X' },
      { kind: 'assault' },
    ]);
    const long = Array.from({ length: 8 }, () => ({ kind: 'wait' as const, hours: 1 }));
    expect(afterLoadSteps({ kind: 'assault', to: 'X' }, long, 8)).toHaveLength(8);
  });
});

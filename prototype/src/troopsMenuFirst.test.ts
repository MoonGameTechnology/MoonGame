import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { planOrders, troopsMenuHtml, troopsModel, type TroopsInput, type TroopsUnitInput } from './troopsMenu';

beforeAll(() => setLocale('ru'));

const unit = (over: Partial<TroopsUnitInput> & { unit: string }): TroopsUnitInput => ({
  garrison: 0,
  garrisonAll: 0,
  hold: 0,
  holdAll: 0,
  queued: 0,
  reserved: 0,
  cargoSize: 1,
  ...over,
});

const input = (over: Partial<TroopsInput> = {}): TroopsInput => ({
  units: [],
  capacity: 8,
  used: 0,
  reservedCargo: 0,
  plan: {},
  ...over,
});

describe('кого первыми — у строки, сведённой из нескольких групп', () => {
  const merged = (plan: Record<string, number>) =>
    input({
      units: [
        unit({
          unit: 'militia',
          key: 'garrison:whole',
          group: 'whole',
          side: 'garrison',
          prepared: true,
          garrison: 6,
          garrisonAll: 6,
          wounded: 2,
          transferSources: [
            { group: 'whole', count: 4 },
            { group: 'hurt', count: 2, wounded: true },
          ],
        }),
      ],
      plan,
    });

  it('спрашивает и у подготовленной строки с группами', () => {
    expect(troopsModel(merged({ 'garrison:whole': 3 })).askFirst).toBe(true);
    expect(troopsModel(merged({ 'garrison:whole': 6 })).askFirst).toBe(false);
  });

  it('ответ решает, из каких групп идёт погрузка', () => {
    const m = troopsModel(merged({ 'garrison:whole': 3 }));
    expect(planOrders(m, 'wounded').load).toEqual([
      { unit: 'militia', group: 'hurt', count: 2 },
      { unit: 'militia', group: 'whole', count: 1 },
    ]);
    expect(planOrders(m, 'healthy').load).toEqual([{ unit: 'militia', group: 'whole', count: 3 }]);
  });

  it('окно отрядов показывает вопрос вместо «Погрузить»', () => {
    const opts = { icon: () => '', name: (u: string) => u };
    const asked = troopsModel({ ...merged({ 'garrison:whole': 3 }), asking: true });
    const html = troopsMenuHtml(asked, opts);
    expect(html).toContain('data-first="wounded"');
    expect(html).toContain('data-first="healthy"');
    expect(html).not.toContain('data-cmd="tok"');
    expect(troopsMenuHtml(troopsModel(merged({ 'garrison:whole': 3 })), opts)).toContain('data-cmd="tok"');
  });
});

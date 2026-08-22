import { describe, expect, it } from 'vitest';
import {
  threatAlerts,
  threatScanDue,
  threatWording,
  threatsHeard,
  type ThreatSighting,
} from './threatAlerts';

const HOUR = 3_600_000;
const sight = (p: Partial<ThreatSighting> = {}): ThreatSighting => ({
  node: 'n1',
  fleetId: 'f1',
  kind: 'inbound',
  eta: 10 * HOUR,
  ...p,
});

describe('правило 1 — не чаще раза в игровой час', () => {
  it('в той же корзине обход не идёт', () => {
    expect(threatScanDue(7, 7)).toBe(false);
  });
  it('новая корзина — идёт', () => {
    expect(threatScanDue(8, 7)).toBe(true);
  });
  it('самый первый проход идёт (память корзин пуста)', () => {
    expect(threatScanDue(0, -1)).toBe(true);
  });
});

describe('правило 2 — выбывшему не звонят', () => {
  it('active слышит', () => {
    expect(threatsHeard('active')).toBe(true);
  });
  it.each(['defeated', 'left', undefined])('%s — нет', (st) => {
    expect(threatsHeard(st)).toBe(false);
  });
});

describe('правило 5 — срок обещается, только пока не истёк', () => {
  it('подход в будущем называет срок', () => {
    expect(threatWording(sight({ eta: 10 * HOUR }), 7 * HOUR)).toEqual({
      key: 'threat.incoming',
      node: 'n1',
      left: 3 * HOUR,
    });
  });
  it('подход с истёкшим сроком говорит «здесь», а не отрицательный срок', () => {
    expect(threatWording(sight({ eta: 5 * HOUR }), 7 * HOUR)).toEqual({
      key: 'threat.here',
      node: 'n1',
      left: null,
    });
  });
  it('ровно сейчас — уже «здесь» (строгое сравнение)', () => {
    expect(threatWording(sight({ eta: 7 * HOUR }), 7 * HOUR).key).toBe('threat.here');
  });
  it.each(['present', 'nearby'] as const)('%s — «здесь» даже с будущим eta', (kind) => {
    expect(threatWording(sight({ kind, eta: 99 * HOUR }), 0).key).toBe('threat.here');
  });
});

describe('правила 3–4 — один звонок на эпизод, кончившийся забывается', () => {
  it('первый раз звенит, второй молчит', () => {
    const mem = new Set<string>();
    expect(threatAlerts([sight()], 0, mem)).toHaveLength(1);
    expect(threatAlerts([sight()], 0, mem)).toHaveLength(0);
  });
  it('другой флот у того же мира — свой эпизод', () => {
    const mem = new Set<string>();
    threatAlerts([sight()], 0, mem);
    expect(threatAlerts([sight(), sight({ fleetId: 'f2' })], 0, mem)).toEqual([
      { key: 'threat.incoming', node: 'n1', left: 10 * HOUR },
    ]);
  });
  it('тот же флот у другого мира — свой эпизод', () => {
    const mem = new Set<string>();
    threatAlerts([sight()], 0, mem);
    expect(threatAlerts([sight({ node: 'n2' })], 0, mem).map((a) => a.node)).toEqual(['n2']);
  });
  it('эпизод кончился и повторился — звенит снова', () => {
    const mem = new Set<string>();
    threatAlerts([sight()], 0, mem);
    expect(threatAlerts([], 0, mem)).toHaveLength(0); // ушёл — память чистится
    expect(mem.size).toBe(0);
    expect(threatAlerts([sight()], 0, mem)).toHaveLength(1); // вернулся — звенит
  });
  it('пока эпизод жив, чистка его не трогает', () => {
    const mem = new Set<string>();
    threatAlerts([sight(), sight({ fleetId: 'f2' })], 0, mem);
    threatAlerts([sight()], 0, mem); // f2 ушёл, f1 остался
    expect([...mem]).toEqual(['n1|f1']);
  });
  it('дубль одной засечки в одном проходе звенит один раз', () => {
    expect(threatAlerts([sight(), sight()], 0, new Set())).toHaveLength(1);
  });
});

describe('правило 6 — порядок тревог = порядок засечек', () => {
  it('ленту не пересортировывает', () => {
    const alerts = threatAlerts(
      [
        sight({ node: 'c', fleetId: 'f3' }),
        sight({ node: 'a', fleetId: 'f1' }),
        sight({ node: 'b', fleetId: 'f2' }),
      ],
      0,
      new Set(),
    );
    expect(alerts.map((a) => a.node)).toEqual(['c', 'a', 'b']);
  });
});

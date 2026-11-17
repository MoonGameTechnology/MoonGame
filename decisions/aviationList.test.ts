import { describe, expect, it } from 'vitest';
import { aviationFabShown, aviationGroups, type AviationRow } from './aviationList';
import type { ParkedState } from './hangarBadge';

const aloft = (strikeId: string, endsAt: number): AviationRow => ({
  kind: 'aloft',
  strikeId,
  squadronId: `sq:${strikeId}`,
  ships: 2,
  endsAt,
});
const READY: ParkedState = { kind: 'ready' };
const BUSY: ParkedState = { kind: 'busy' };
const fuel = (readyAt: number): ParkedState => ({ kind: 'refueling', readyAt });
const parked = (squadronId: string, state: ParkedState): AviationRow => ({
  kind: 'parked',
  squadronId,
  ships: 1,
  state,
});

const ids = (rows: AviationRow[]) =>
  rows.map((r) => (r.kind === 'aloft' ? r.strikeId : r.squadronId));

describe('список «◇ Авиация»', () => {
  it('группы в порядке «в полёте», «готовы», «ждут»; пустых нет', () => {
    const groups = aviationGroups([parked('a', fuel(3)), aloft('s1', 50), parked('b', READY)]);
    expect(groups.map((g) => g.id)).toEqual(['aloft', 'ready', 'waiting']);
    expect(aviationGroups([parked('b', READY)]).map((g) => g.id)).toEqual(['ready']);
    expect(aviationGroups([])).toEqual([]);
  });

  it('заправка и бой носителя — в «ждут»; сначала скорая заправка, бой без срока в конце', () => {
    const [g] = aviationGroups([
      parked('busy', BUSY),
      parked('long', fuel(5)),
      parked('short', fuel(1)),
    ]);
    expect(g!.id).toBe('waiting');
    expect(ids(g!.rows)).toEqual(['short', 'long', 'busy']);
  });

  it('вылеты — по концу нынешней ноги; готовые — в порядке обхода баз', () => {
    const groups = aviationGroups([
      aloft('late', 900),
      parked('x', READY),
      aloft('early', 100),
      parked('y', READY),
    ]);
    expect(ids(groups[0]!.rows)).toEqual(['early', 'late']);
    expect(ids(groups[1]!.rows)).toEqual(['x', 'y']);
  });

  it('плавающая кнопка — только когда эскадры есть и ничего не выделено', () => {
    expect(aviationFabShown(2, false)).toBe(true);
    expect(aviationFabShown(0, false)).toBe(false);
    expect(aviationFabShown(2, true)).toBe(false);
  });
});

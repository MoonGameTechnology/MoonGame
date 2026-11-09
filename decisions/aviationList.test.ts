import { describe, expect, it } from 'vitest';
import { aviationFabShown, aviationGroups, type AviationRow } from './aviationList';
import type { BaseBlock } from './hangarBadge';

const aloft = (strikeId: string, endsAt: number): AviationRow => ({
  kind: 'aloft',
  strikeId,
  squadronId: `sq:${strikeId}`,
  ships: 2,
  endsAt,
});
const parked = (
  squadronId: string,
  block: BaseBlock,
  rearmHours: number | null = null,
): AviationRow => ({ kind: 'parked', squadronId, ships: 1, block, rearmHours });

const ids = (rows: AviationRow[]) =>
  rows.map((r) => (r.kind === 'aloft' ? r.strikeId : r.squadronId));

describe('список «◇ Авиация»', () => {
  it('группы в порядке «в полёте», «готовы», «перезарядка»; пустых нет', () => {
    const groups = aviationGroups([parked('a', 'rearming', 3), aloft('s1', 50), parked('b', null)]);
    expect(groups.map((g) => g.id)).toEqual(['aloft', 'ready', 'waiting']);
    expect(aviationGroups([parked('b', null)]).map((g) => g.id)).toEqual(['ready']);
    expect(aviationGroups([])).toEqual([]);
  });

  it('ждущие топлива и конца боя — в «перезарядке», после тех, у кого есть срок', () => {
    const [g] = aviationGroups([
      parked('fuel', 'no-fuel'),
      parked('long', 'rearming', 5),
      parked('busy', 'busy'),
      parked('short', 'rearming', 1),
    ]);
    expect(g!.id).toBe('waiting');
    expect(ids(g!.rows)).toEqual(['short', 'long', 'fuel', 'busy']);
  });

  it('вылеты — по концу нынешней ноги; готовые — в порядке обхода баз', () => {
    const groups = aviationGroups([
      aloft('late', 900),
      parked('x', null),
      aloft('early', 100),
      parked('y', null),
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

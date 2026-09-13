import { describe, expect, it } from 'vitest';
import { NO_SELECTION, selectFleets, toggleInSelection } from './fleetSelection';

const своё = (id: string): boolean => id.startsWith('my');

describe('что значит выделить флот', () => {
  it('РОВНО ОДИН — он же «текущий»: у одиночного флота своя карточка', () => {
    expect(selectFleets(['my1'], своё)).toEqual({ picked: ['my1'], single: 'my1', inspect: null });
  });

  it('несколько — «текущего» НЕТ: иначе приказ ушёл бы одному из группы', () => {
    expect(selectFleets(['my1', 'my2'], своё)).toEqual({
      picked: ['my1', 'my2'],
      single: null,
      inspect: null,
    });
  });

  it('ТОЛЬКО СВОЁ: чужие отсеиваются на входе, а не отказом на каждом приказе', () => {
    expect(selectFleets(['my1', 'foe1', 'foe2'], своё)).toEqual({
      picked: ['my1'],
      single: 'my1',
      inspect: null,
    });
  });

  it('одни чужие — пустое выделение', () => {
    expect(selectFleets(['foe1', 'foe2'], своё)).toEqual({
      picked: [],
      single: null,
      inspect: null, // двое чужих — это не осмотр, а промах по стопке
    });
  });

  it('пустой список — пустое выделение', () => {
    expect(selectFleets([], своё)).toEqual(NO_SELECTION);
  });

  it('порядок выделенных сохраняется — им подписаны строки списка группы', () => {
    expect(selectFleets(['my2', 'my1', 'my3'], своё).picked).toEqual(['my2', 'my1', 'my3']);
  });
});

describe('правило 6 — одинокий чужой уходит на ОСМОТР (UI-14)', () => {
  it('тап по чужому флоту даёт осмотр, а не пустоту', () => {
    expect(selectFleets(['foe1'], своё)).toEqual({ picked: [], single: null, inspect: 'foe1' });
  });

  it('осмотр НЕ становится адресом приказа: своего в наборе нет', () => {
    const sel = selectFleets(['foe1'], своё);
    expect(sel.single).toBeNull(); // `single` — куда уйдёт приказ; чужому нельзя
    expect(sel.picked).toEqual([]);
  });

  it('рамка со своим и чужим — это выбор группы, а не осмотр', () => {
    expect(selectFleets(['my1', 'foe1'], своё).inspect).toBeNull();
  });

  it('двое чужих под тапом — промах по стопке, осмотра нет', () => {
    expect(selectFleets(['foe1', 'foe2'], своё).inspect).toBeNull();
  });
});

describe('Ctrl-клик по флоту', () => {
  it('СКЛАДЫВАЕТ текущий одиночный в группу, а не заменяет его', () => {
    const было = selectFleets(['my1'], своё);
    expect(toggleInSelection(было, 'my2', своё)).toEqual(['my1', 'my2']);
  });

  it('повторный клик по тому же — убирает из набора', () => {
    const было = selectFleets(['my1', 'my2'], своё);
    expect(toggleInSelection(было, 'my2', своё)).toEqual(['my1']);
  });

  it('клик по единственному выделенному — снимает выделение', () => {
    const было = selectFleets(['my1'], своё);
    expect(toggleInSelection(было, 'my1', своё)).toEqual([]);
  });

  it('ЧУЖОЙ НЕ ТРОГАЕТ НАБОР ВОВСЕ: null, а не «схлопнуть и отфильтровать»', () => {
    const было = selectFleets(['my1'], своё);
    expect(toggleInSelection(было, 'foe1', своё)).toBe(null);
  });

  it('с пустого выделения набирается первый флот', () => {
    expect(toggleInSelection(NO_SELECTION, 'my1', своё)).toEqual(['my1']);
  });

  it('повторов в наборе не появляется', () => {
    const было = selectFleets(['my1', 'my2'], своё);
    const после = toggleInSelection(было, 'my3', своё);
    expect(после).toEqual(['my1', 'my2', 'my3']);
    expect(new Set(после).size).toBe(3);
  });
});

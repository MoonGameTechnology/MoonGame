import { describe, it, expect } from 'vitest';
import {
  anyLivePlan,
  plansDiffer,
  stayingFleets,
  stripState,
  type StripInput,
} from './chainStripState';

const ME = 'p1';
const вход = (over: Partial<StripInput> = {}): StripInput => ({
  steps: 1,
  gestures: 1,
  cap: 8,
  plans: ['[]'],
  hasHome: true,
  ...over,
});

describe('режим «Приказ» — кто остаётся в режиме', () => {
  it('РЕЖИМ НЕ ВИСИТ НАД ПУСТОТОЙ: погибшие и чужие флоты выпадают', () => {
    const владелец = (id: string) => ({ a: ME, b: 'p2', c: undefined })[id as 'a' | 'b' | 'c'];
    expect(stayingFleets(['a', 'b', 'c'], владелец, ME)).toEqual(['a']);
  });

  it('никого не осталось — пустой список, и вызывающий закрывает режим', () => {
    expect(stayingFleets(['x'], () => 'p2', ME)).toEqual([]);
  });

  it('порядок выбранных сохраняется', () => {
    expect(stayingFleets(['a', 'b'], () => ME, ME)).toEqual(['a', 'b']);
  });
});

describe('режим «Приказ» — кнопки полоски', () => {
  it('«ОТМЕНИТЬ» ЖИВЁТ ПО ЖЕСТАМ, А НЕ ПО ШАГАМ: часы складываются в один жест', () => {
    expect(stripState(вход({ steps: 4, gestures: 1 })).canUndo).toBe(true);
    expect(stripState(вход({ steps: 4, gestures: 0 })).canUndo).toBe(false);
  });

  it('«ДОМОЙ» ГАСНЕТ У ПОТОЛКА ШАГОВ — иначе обещает шаг, которого не будет', () => {
    expect(stripState(вход({ steps: 8, cap: 8 })).canHome).toBe(false);
    expect(stripState(вход({ steps: 7, cap: 8 })).canHome).toBe(true);
  });

  it('«ДОМОЙ» ГАСНЕТ И БЕЗ СВОЕГО МИРА У ФИНИША', () => {
    expect(stripState(вход({ hasHome: false })).canHome).toBe(false);
  });

  it('ПУСТОЙ ЧЕРНОВИК ПРИ ЖИВОМ ПЛАНЕ — ЭТО «ОЧИСТИТЬ»: другого способа снять приказ нет', () => {
    const st = stripState(вход({ steps: 0, plans: ['[{"kind":"move"}]'] }));
    expect(st.clearMode).toBe(true);
    expect(st.canSend).toBe(true);
  });

  it('пустое поверх пустого — отправлять нечего', () => {
    const st = stripState(вход({ steps: 0, plans: ['[]'] }));
    expect(st.clearMode).toBe(false);
    expect(st.canSend).toBe(false);
  });

  it('непустой черновик отправляется всегда', () => {
    expect(stripState(вход({ steps: 2, plans: ['[]'] })).canSend).toBe(true);
  });

  it('черновик есть — это уже не режим очистки', () => {
    expect(stripState(вход({ steps: 2, plans: ['[{"kind":"move"}]'] })).clearMode).toBe(false);
  });
});

describe('режим «Приказ» — предупреждение о перезаписи', () => {
  it('РАЗНЫЕ ПЛАНЫ У ВЫБРАННЫХ — ОДИН ПРИКАЗ ЗАТРЁТ НЕСКОЛЬКО', () => {
    expect(plansDiffer(['[]', '[{"kind":"move"}]'])).toBe(true);
    expect(stripState(вход({ plans: ['[]', '[{"kind":"move"}]'] })).overwrite).toBe(true);
  });

  it('одинаковые планы предупреждения не требуют', () => {
    expect(plansDiffer(['[]', '[]'])).toBe(false);
    expect(plansDiffer(['[{"kind":"move"}]', '[{"kind":"move"}]'])).toBe(false);
  });

  it('один флот — сравнивать не с чем', () => {
    expect(plansDiffer(['[]'])).toBe(false);
  });

  it('живой план виден хотя бы у одного', () => {
    expect(anyLivePlan(['[]', '[{"kind":"wait"}]'])).toBe(true);
    expect(anyLivePlan(['[]', '[]'])).toBe(false);
  });
});

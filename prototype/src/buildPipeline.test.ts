import { describe, expect, it } from 'vitest';
import {
  RALLY_TRAIT,
  rallyCloses,
  shipsPending,
  withoutRally,
  type RallyFleetView,
} from './buildPipeline';

const флот = (p: Partial<RallyFleetView> = {}): RallyFleetView => ({
  mine: true,
  location: 'n1',
  moving: false,
  traits: [RALLY_TRAIT],
  ...p,
});
const строит = (миры: string[]) => (id: string) => миры.includes(id);

describe('правило 1 — сбор закрывается, когда мир перестал строить корабли', () => {
  it('идёт постройка — сбор жив', () => {
    expect(rallyCloses(флот(), строит(['n1']))).toBe(false);
  });
  it('мир опустел — сбор закрывается', () => {
    expect(rallyCloses(флот(), строит([]))).toBe(true);
  });
  it('строит ДРУГОЙ мир — этому сбору всё равно', () => {
    expect(rallyCloses(флот(), строит(['n2']))).toBe(true);
  });
  it.each([
    [true, 0, true],
    [false, 2, true],
    [true, 5, true],
    [false, 0, false],
  ])('идёт=%s, в очереди=%i → строит: %s', (active, queued, ожидание) => {
    expect(shipsPending(active, queued)).toBe(ожидание);
  });
});

describe('правило 2 — закрытие снимает метку, а не распускает флот', () => {
  it('метка уходит, остальные остаются', () => {
    expect(withoutRally(['rally', 'escort', 'veteran'])).toEqual(['escort', 'veteran']);
  });
  it('снимает все копии метки', () => {
    expect(withoutRally(['rally', 'rally'])).toEqual([]);
  });
  it('флот без метки не портится', () => {
    expect(withoutRally(['escort'])).toEqual(['escort']);
  });
  it('исходный список не меняется', () => {
    const было = ['rally', 'escort'];
    withoutRally(было);
    expect(было).toEqual(['rally', 'escort']);
  });
});

describe('правило 3 и чужие флоты — решения о сборе не принимают', () => {
  it('летящий флот не трогают, даже если его мир пуст', () => {
    expect(rallyCloses(флот({ moving: true }), строит([]))).toBe(false);
  });
  it('флот без мира под ногами не трогают', () => {
    expect(rallyCloses(флот({ location: null }), строит([]))).toBe(false);
  });
  it('чужой флот не трогают', () => {
    expect(rallyCloses(флот({ mine: false }), строит([]))).toBe(false);
  });
  it('флот без метки закрывать нечего', () => {
    expect(rallyCloses(флот({ traits: ['escort'] }), строит([]))).toBe(false);
  });
  it('флот вообще без меток не ломает решение', () => {
    expect(rallyCloses(флот({ traits: undefined }), строит([]))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BUILD_LANES,
  RALLY_TRAIT,
  headStarts,
  queueRuns,
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

describe('правило 1 — очередь двигают только у своего мира', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('очередь=%s, мир мой=%s → %s', (hasQueue, mine, ожидание) => {
    expect(queueRuns(hasQueue, mine)).toBe(ожидание);
  });
});

describe('правила 2–4 — когда голова полосы уезжает в ядро', () => {
  it('пока полоса занята, голова ждёт', () => {
    expect(headStarts(true, () => false)).toBe(false);
  });
  it('«ждём денег» держит голову', () => {
    expect(headStarts(false, () => true)).toBe(false);
  });
  it('занято И без денег — тем более ждёт', () => {
    expect(headStarts(true, () => true)).toBe(false);
  });
  it('правило 9 — у занятой полосы вердикт у ядра НЕ спрашивают', () => {
    let спрошено = 0;
    headStarts(true, () => {
      спрошено++;
      return false;
    });
    expect(спрошено).toBe(0);
  });
  it('правило 9 — у свободной спрашивают ровно один раз', () => {
    let спрошено = 0;
    headStarts(false, () => {
      спрошено++;
      return false;
    });
    expect(спрошено).toBe(1);
  });
  it('свободная полоса и вердикт не про деньги — пускаем', () => {
    // waitsForMoney=false покрывает и «нет верфи», и «максимальный уровень», и обстрел:
    // любой НЕденежный отказ голову не держит, она едет за настоящей причиной
    expect(headStarts(false, () => false)).toBe(true);
  });
});

describe('правило 3 — полосы независимы', () => {
  it('их ровно две и здания идут раньше кораблей', () => {
    expect([...BUILD_LANES]).toEqual(['buildings', 'units']);
  });
  it('занятость одной полосы не влияет на другую', () => {
    expect(headStarts(true, () => false)).toBe(false); // в этой полосе уже строят
    expect(headStarts(false, () => false)).toBe(true); // а в соседней свободно
  });
});

describe('правило 6 — сбор закрывается, когда мир перестал строить корабли', () => {
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

describe('правило 7 — закрытие снимает метку, а не распускает флот', () => {
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

describe('правило 8 и чужие флоты — решения о сборе не принимают', () => {
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

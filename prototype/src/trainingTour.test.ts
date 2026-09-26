import { describe, it, expect } from 'vitest';

import { buildTrainingTour } from './trainingTour';
import { SpotlightTour, type SpotlightView } from './spotlight';
import { data } from './gameData';
import { trainingState } from '../../packages/client/src/gameData';
import { TRAINING_STAGES, trainingBaseline } from '../../decisions/trainingStages';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import type { GameState } from '../../packages/shared-core/src/index';

function tour(world: () => GameState, selected = () => false) {
  return buildTrainingTour({
    world,
    me: 'p1',
    data,
    baseline: trainingBaseline(world(), 'p1', data),
    fleetSelected: selected,
  });
}

describe('цепочка подсказок учебного полигона (TRN-2)', () => {
  const s = trainingState(data);
  const steps = tour(() => s);

  it('проходит все двенадцать этапов §14.4 по порядку', () => {
    const order = steps.map((x) => x.stage).filter((x, i, a) => a.indexOf(x) === i);
    expect(order).toEqual([...TRAINING_STAGES]);
  });

  it('ни один шаг не листается кнопкой «Далее» — этап закрывает дело', () => {
    expect(steps.filter((x) => x.advance.on === 'tap').map((x) => x.id)).toEqual([]);
  });

  it('текст каждого шага и название каждого этапа есть в обеих локалях', () => {
    const keys = [...steps.map((x) => x.copy), ...TRAINING_STAGES.map((x) => `training.stage.${x}`)];
    expect(keys.filter((k) => !(k in ru))).toEqual([]);
    expect(keys.filter((k) => !(k in en))).toEqual([]);
  });

  it('подсказки без цели — пузырь не закрывает карту', () => {
    expect(steps.every((x) => x.target === null)).toBe(true);
  });

  it('этап засчитывается по состоянию мира и сразу, если дело уже сделано', () => {
    let world = s;
    let selected = false;
    const views: (SpotlightView | null)[] = [];
    const t = new SpotlightTour(tour(() => world, () => selected), {
      locate: () => null,
      render: (v) => views.push(v),
    });
    t.start();
    expect(views.at(-1)?.stage).toEqual({ id: 'prep', index: 0, count: 12 });
    t.tap(); // «Далее» у этапа нет — не листается
    expect(views.at(-1)?.stage?.id).toBe('prep');
    selected = true;
    t.refresh();
    expect(views.at(-1)?.stage?.id).toBe('economy');
    // Нейтральная планета уже взята, пока игрок шёл по экономике: этап расширения
    // засчитается сразу, как только до него дойдёт очередь.
    world = structuredClone(s);
    world.planets.neutral!.owner = 'p1';
    t.skipStage(); // экономика
    t.skipStage(); // исследование → расширение засчитано на входе
    expect(views.at(-1)?.stage?.id).toBe('missions');
  });

  it('действие засчитывает только свой приказ', () => {
    const t = new SpotlightTour(steps, { locate: () => null, render: () => {} });
    t.start();
    for (let i = 0; i < 5; i++) t.skipStage(); // к «Управлению флотом»
    expect(steps[t.index]?.id).toBe('fleet.split');
    t.notifyAction('fleet.move');
    expect(steps[t.index]?.id).toBe('fleet.split');
    t.notifyAction('fleet.split');
    expect(steps[t.index]?.id).toBe('fleet.merge');
  });
});

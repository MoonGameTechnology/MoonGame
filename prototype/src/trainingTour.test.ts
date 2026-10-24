import { describe, it, expect } from 'vitest';
import { buildTrainingTour } from './trainingTour';
import { trainingUiFixture } from './trainingTour.fixture';
import { SpotlightTour, type SpotlightView } from './spotlight';
import { data } from './gameData';
import { trainingState } from '../../packages/client/src/gameData';
import { TRAINING_STAGES, trainingBaseline } from '../../decisions/trainingStages';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';

const world = () => trainingState(data);
const steps = (mobile = false) =>
  buildTrainingTour({
    world,
    me: 'p1',
    data,
    baseline: trainingBaseline(world(), 'p1', data),
    ui: trainingUiFixture(mobile),
  });

describe('пошаговый полигон Sector Zero', () => {
  it('сохраняет двенадцать этапов и проверку каждого действия', () => {
    const all = steps(true);
    expect([...new Set(all.map((s) => s.stage))]).toEqual([...TRAINING_STAGES]);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.every((s) => s.advance.on !== 'tap')).toBe(true);
    expect(all.filter((s) => s.target || s.anchor || s.selector).length).toBeGreaterThan(75);
  });
  it('каждая инструкция переведена; кнопки телефона не попадают на ПК', () => {
    for (const s of steps(true)) {
      expect(ru[s.copy], s.copy).toBeTruthy();
      expect(en[s.copy], s.copy).toBeTruthy();
    }
    expect(steps().some((s) => s.target?.includes('mobile-send'))).toBe(false);
    expect(steps(true).some((s) => s.target?.includes('mobile-send'))).toBe(true);
  });
  it('пропуск и сворачивание работают при недоступной цели, а пауза отпускается', () => {
    const views: (SpotlightView | null)[] = [];
    const t = new SpotlightTour(steps(), { locate: () => null, render: (v) => views.push(v) });
    t.start();
    expect(t.holdsClock).toBe(true);
    t.tap();
    expect(views.at(-1)?.step.id).toBe('prep.base');
    t.collapse();
    expect(t.holdsClock).toBe(false);
    t.reopen();
    expect(t.holdsClock).toBe(true);
    t.skipStage();
    expect(views.at(-1)?.stage?.id).toBe('economy');
    t.skip();
    expect(t.holdsClock).toBe(false);
    expect(t.active).toBe(false);
  });
  it('пауза не останавливает ожидание строительства, исследования и погрузки', () => {
    const waits = [
      'economy.mine',
      'economy.ship',
      'research.grid',
      'assault.load',
      'finale.load',
      'retreat.battle',
    ];
    for (const id of waits) expect(steps().find((s) => s.id === id)?.holdClock, id).toBe(false);
  });
  it('обстрел не завершается после первого попадания: ждёт разрушения форта', () => {
    const s = world();
    const all = buildTrainingTour({
      world: () => s,
      me: 'p1',
      data,
      baseline: trainingBaseline(s, 'p1', data),
      ui: trainingUiFixture(),
    });
    const wait = all.find((x) => x.id === 'finale.target-bombard-wait')!;
    expect(wait.holdClock).toBe(false);
    if (wait.advance.on !== 'state') throw new Error('expected a state check');
    const fort = s.planets.target!.buildings.find((b) => b.type === 'fort')!;
    fort.hp = 1;
    expect(wait.advance.when()).toBe(false);
    s.planets.target!.buildings = s.planets.target!.buildings.filter((b) => b !== fort);
    expect(wait.advance.when()).toBe(true);
  });
  it('неверный приказ не завершает разделение флота', () => {
    const split = steps().find((s) => s.id === 'fleet.split')!;
    const t = new SpotlightTour([split], { locate: () => null, render: () => {} });
    t.start();
    t.notifyAction('fleet.move');
    expect(t.active).toBe(true);
    t.notifyAction('fleet.split');
    expect(t.active).toBe(false);
  });
});

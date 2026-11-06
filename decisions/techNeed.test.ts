/**
 * ПРИЁМКА РЕШЕНИЯ «ЧТО ИЗУЧИТЬ» (предложение технологии у юнитов и зданий).
 *
 * Список берётся у ядра (`technologiesUnlocking`) — его и сверяем, а не свою таблицу: решение
 * не должно ни назвать технологию, которая ничего не открывает, ни промолчать о той, без
 * которой ядро отбивает заказ. Сам паритет с отказом `E_TECH_LOCKED` настоящего приказа
 * держит тест окна стройки (`prototype/src/buildScreen.test.ts`) — там есть ядро прототипа.
 */
import { describe, expect, it } from 'vitest';
import { techNeed } from './techNeed';
import { shippedGameData } from '../data/bundle';
import { technologiesUnlocking } from '../packages/shared-core/src/index';
import type { GameState, Player } from '../packages/shared-core/src/index';

const data = shippedGameData();

/** Мир основной игры: дерево `main`, у игрока изучен только разведчик (как на старте). */
function world(tech: Player['technologies'] = { completed: ['scout_design'] }, exclude: string[] = []) {
  return {
    players: { p1: { id: 'p1', technologies: tech } as unknown as Player },
    techRules: { ruleset: 'main', dayGates: true, exclude },
  } satisfies Pick<GameState, 'players' | 'techRules'>;
}

describe('что изучить, чтобы открыть юнит или здание', () => {
  it('не изучено — называет технологию ядра и предлагает её', () => {
    expect(techNeed(world(), 'p1', data, 'unit', 'frigate')).toEqual({
      needs: ['frigate_design'],
      offer: 'frigate_design',
      status: 'locked',
      queuePos: 0,
    });
    expect(techNeed(world(), 'p1', data, 'building', 'spaceport')?.offer).toBe('spaceport_infrastructure');
  });

  it('у каждого запертого юнита и здания предложение — из списка ядра', () => {
    const s = world();
    const all = [
      ...Object.keys(data.units).map((id) => ['unit', id] as const),
      ...Object.keys(data.buildings).map((id) => ['building', id] as const),
    ];
    let offered = 0;
    for (const [kind, id] of all) {
      const need = techNeed(s, 'p1', data, kind, id);
      if (!need) continue;
      offered++;
      expect(technologiesUnlocking(data, kind, id, s), id).toContain(need.offer);
      expect(need.needs, id).toContain(need.offer);
    }
    expect(offered).toBeGreaterThan(10); // в основной игре заперто почти всё — тест не пустой
  });

  it('изучено — ворот нет', () => {
    expect(techNeed(world(), 'p1', data, 'unit', 'scout')).toBeNull();
    expect(
      techNeed(world({ completed: ['scout_design', 'frigate_design'] }), 'p1', data, 'unit', 'frigate'),
    ).toBeNull();
  });

  it('ворот нет в данных — предлагать нечего', () => {
    // Казармы стоят на старте любого мира и ничем не заперты.
    expect(technologiesUnlocking(data, 'building', 'barracks', world())).toEqual([]);
    expect(techNeed(world(), 'p1', data, 'building', 'barracks')).toBeNull();
  });

  it('идёт исследование — предлагает его и говорит, что оно идёт', () => {
    const tech = {
      completed: ['scout_design'],
      active: [{ technology: 'frigate_design', startedAt: 0, completesAt: 10 }],
    };
    expect(techNeed(world(tech), 'p1', data, 'unit', 'frigate')).toMatchObject({
      offer: 'frigate_design',
      status: 'running',
    });
  });

  it('матч, сохранённый до слотов, держит идущее исследование объектом — читается так же', () => {
    const tech = {
      completed: ['scout_design'],
      active: { technology: 'frigate_design', startedAt: 0, completesAt: 10 },
    } as unknown as Player['technologies'];
    expect(techNeed(world(tech), 'p1', data, 'unit', 'frigate')?.status).toBe('running');
  });

  it('стоит в очереди исследований — говорит место', () => {
    const tech = { completed: ['scout_design'], queue: ['militia_training', 'frigate_design'] };
    expect(techNeed(world(tech), 'p1', data, 'unit', 'frigate')).toMatchObject({
      offer: 'frigate_design',
      status: 'queued',
      queuePos: 2,
    });
  });

  it('технологии нет в этом матче — в досье вести некуда, предложения нет', () => {
    expect(techNeed(world(undefined, ['frigate_design']), 'p1', data, 'unit', 'frigate')).toBeNull();
  });
});

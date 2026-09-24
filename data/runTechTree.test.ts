/**
 * ДЕРЕВО ТЕХНОЛОГИЙ ЗАБЕГА (PVR-6.17, заказ владельца 2026-09-24: «технологии из сетевой
 * игры надо переделать под Sector Zero — там дневные ограничения, Хранитель, которого нет,
 * и т. д.»).
 *
 * Здесь закреплены ДАННЫЕ режима забега: что в его дереве остаётся и что это дерево
 * проходимо без сетевой обвязки. Правило держат модульные тесты ядра
 * (`technology.test.ts`), окно — `techTree.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { pveModeId } from '../packages/client/src/gameData';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const mode = data.modes[pveModeId() ?? ''];
const rules = mode?.technology;
const tree = Object.entries(data.technologies).filter(
  ([id, def]) => !def.grantOnly && !(rules?.exclude ?? []).includes(id),
);

describe('PVR-6.17 — дерево технологий забега', () => {
  it('у режима забега есть своё дерево, и ворота дней в нём сняты', () => {
    expect(rules).toBeDefined();
    expect(rules?.dayGates).toBe(false);
  });

  it('«Хранителя» в забеге нет: его способность живёт только в сетевом матче', () => {
    expect(rules?.exclude).toContain('ai_stewardship');
    const steward = tree.filter(([, def]) => (def.unlocks?.abilities ?? []).includes('steward'));
    expect(steward.map(([id]) => id)).toEqual([]);
  });

  it('исключаются только настоящие узлы — опечатка не выключает ничего молча', () => {
    for (const id of rules?.exclude ?? []) expect(data.technologies[id], id).toBeDefined();
  });

  it('ни один оставшийся узел не ждёт убранного предка', () => {
    const left = new Set(tree.map(([id]) => id));
    for (const [id, def] of tree) {
      for (const pre of def.prerequisites ?? []) expect(left.has(pre), `${id} ← ${pre}`).toBe(true);
    }
  });

  it('ни один оставшийся узел не заперт на совет учёных — у забега его нет', () => {
    const gated = tree.filter(([, def]) =>
      (def.conditions ?? []).some((c) => c.type === 'has_scientist'),
    );
    expect(gated.map(([id]) => id)).toEqual([]);
  });
});

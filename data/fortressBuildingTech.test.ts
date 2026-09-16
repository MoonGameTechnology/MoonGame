/**
 * ПОСТРОЙКИ КРЕПОСТИ ЗА ТЕХНОЛОГИЯМИ (FORT-5.11; решение владельца 12, вторая половина:
 * «постройки крепости можно открыть в технологиях»).
 *
 * Гейт поставлен только на СОБСТВЕННОЕ здание крепости — ангар. Остальное в её ростере
 * (радар, форт, электростанция, фабрикатор) доступно с первой минуты, и запирать его
 * значило бы молча переписать экономику, о чём прямо предупреждает сторож в
 * `schemas.test.ts`. Ангар же заведён в тот же день и по определению недоступен в минуту
 * первую — до него надо сперва изучить саму крепость.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  technologyModule,
  type Action,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([technologyModule, constructionModule]);

function world(completed: string[]): GameState {
  const s = createInitialState({ seed: 'fbt', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'x', status: 'active',
        resources: Object.fromEntries(data.resources.map((r) => [r, 99000])),
        technologies: { completed },
      },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'void_station', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: 'starfort', level: 3, hp: 160 }], garrison: [], traits: [],
      },
    },
  };
}
const build = (building: string): Action => ({
  id: 's:p1:1', type: 'building.construct', playerId: 'p1', payload: { planetId: 'A', building }, issuedAt: 0,
});
const order = (completed: string[], building: string): string | true => {
  const r = kernel.applyAction(world(completed), build(building), ctx());
  return r.ok ? true : r.code;
};

describe('постройки крепости за технологиями — FORT-5.11', () => {
  it('АНГАР без своей технологии не строится, с ней — строится', () => {
    expect(order([], 'void_hangar')).toBe('E_TECH_LOCKED');
    expect(order(['void_shipworks'], 'void_hangar')).toBe(true);
  });

  it('остальной ростер крепости НЕ заперт — иначе экономика поехала бы молча', () => {
    // Граница из шапки сторожа гейтов: запирать доступное с первой минуты дорого, а
    // запирать ещё-не-существующее дёшево. Здесь проверяется именно она.
    for (const building of ['radar', 'fort', 'power_plant', 'fabricator']) {
      expect(order([], building), `${building} внезапно заперт`).toBe(true);
    }
  });

  it('ветка имеет ГЛУБИНУ: ангар стоит за крепостью, а не рядом с ней', () => {
    // Решение 12 просило открывать «сначала крепость, потом её постройки». Плоская ветка
    // из двух независимых узлов это обещание не выполняла бы.
    const shipworks = data.technologies.void_shipworks;
    expect(shipworks?.prerequisites).toContain('void_fortification');
  });
});

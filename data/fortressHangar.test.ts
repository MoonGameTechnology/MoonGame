/**
 * АНГАР КРЕПОСТИ (FORT-5.7; решение владельца 14 — §0.7 роадмапа).
 *
 * «Базирование челноков — отдельным зданием крепости, а не космопортом планеты.»
 *
 * Правка вышла ЧИСТО ДАННЫМИ, и тест это и проверяет: механика вместимости уже считает
 * `shuttleBay` по всем стоящим зданиям (`shuttleBayAt`), значит новому зданию достаточно
 * объявить поле. Но у переезда есть вторая половина, о которой легко забыть: космопорт
 * давал крепости не только причал, а ещё кредиты и ремонт — убрать его и не возместить
 * значило бы тихо обеднить крепость.
 */
import { describe, expect, it } from 'vitest';
import {
  buildingLevel,
  constructionModule,
  createInitialState,
  createKernel,
  shuttleBayAt,
  type Action,
  type Context,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HANGAR = 'void_hangar';
const ctx = (now = 0): Context => ({ now, data });

function node(kind: string, buildings: string[]): Planet {
  return {
    id: 'A', owner: 'p1', kind, position: { x: 0, y: 0 }, links: [],
    resources: {}, buildings: buildings.map((type) => ({ type, level: 1, hp: 100 })),
    garrison: [], traits: [],
  };
}
function world(planet: Planet): GameState {
  const s = createInitialState({ seed: 'fh', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'x', status: 'active',
        // Все ресурсы каталога, а не три названных: иначе тест падает не на правиле, а
        // на кошельке, стоит челноку подорожать или начать стоить чем-то ещё.
        resources: Object.fromEntries(data.resources.map((r) => [r, 99000])),
      },
    },
    planets: { A: planet },
  };
}
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0,
});

describe('ангар крепости — решение владельца 14', () => {
  it('даёт крепости вместимость под челноки', () => {
    // Через настоящий счёт ядра, а не чтением json: вместимость узла — сумма
    // `shuttleBay` по стоящим зданиям, и ангар обязан в неё попадать.
    expect(shuttleBayAt(node('void_station', []), data)).toBe(0);
    expect(shuttleBayAt(node('void_station', [HANGAR]), data)).toBeGreaterThan(0);
  });

  it('челнок реально закладывается на крепости с ангаром, а без него — нет', () => {
    const kernel = createKernel([constructionModule]);
    const shuttle = Object.entries(data.units).find(([, u]) => u.traits.includes('shuttle'))![0];
    const withHangar = kernel.applyAction(
      world(node('void_station', [HANGAR])), act('unit.build', { planetId: 'A', unit: shuttle }), ctx(),
    );
    expect(withHangar.ok, withHangar.ok ? '' : `отказ ${withHangar.code}`).toBe(true);
    const without = kernel.applyAction(
      world(node('void_station', ['shipyard'])), act('unit.build', { planetId: 'A', unit: shuttle }), ctx(),
    );
    expect(without.ok).toBe(false);
    expect(without.ok ? '' : without.code).toBe('E_NO_PORT');
  });

  it('ангар СТОИТ только на крепости — на планете его не поставить', () => {
    const kernel = createKernel([constructionModule]);
    const r = kernel.applyAction(world(node('planet', [])), act('building.construct', { planetId: 'A', building: HANGAR }), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_WRONG_SECTOR');
  });

  it('переезд НИЧЕГО не отнял: ангар несёт и кредиты, и ремонт, как космопорт', () => {
    // Вторая половина, о которой легко забыть. Космопорт уехал из ростера крепости, и
    // будь ангар «только причалом», крепость молча лишилась бы дохода и дока.
    const port = buildingLevel(data.buildings.spaceport!, 1);
    const hangar = buildingLevel(data.buildings[HANGAR]!, 1);
    expect(hangar.shuttleBay).toBe(port.shuttleBay);
    expect(hangar.shipRepair).toBe(port.shipRepair);
    expect(hangar.produces.credits ?? 0).toBe(port.produces.credits ?? 0);
  });
});

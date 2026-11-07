import { describe, expect, it } from 'vitest';
import { newGame, canOrder } from './game';
import { data } from './gameData';
import { productionCatalogTile } from './productionCatalog';
import { buildScreenHtml } from './buildScreen';
import { cost, fmtDur, resChip } from './format';
import { buildingLevel, matchCost } from '../../packages/shared-core/src/index';

describe('production presentation with pinned match pricing', () => {
  it('shows the additional unit multiplier in both space and ground catalogs', () => {
    const state = newGame();
    state.pricing = { hours: 2, unitHours: 2, buildingHours: 3 };
    const world = Object.values(state.planets).find(p => p.owner === 'p1')!;
    for (const id of ['frigate', 'tank']) {
      const html = productionCatalogTile(state, 'p1', world.id, id, id);
      expect(html).toContain(`<small>${fmtDur(data.units[id]!.buildTimeHours * 4)}</small>`);
    }
  });

  it('compact building rows keep the core quote, next output and building multiplier', () => {
    const state = newGame();
    state.pricing = { hours: 2, unitHours: 2, buildingHours: 3 };
    state.players.p1!.resources = Object.fromEntries(data.resources.map(id => [id, 90000]));
    const world = Object.values(state.planets).find(p => p.owner === 'p1')!;
    const mine = world.buildings.find(b => b.type === 'mine')!;
    mine.level = 1;
    const html = buildScreenHtml(state, 'p1', world.id, action => canOrder(state, action), () => false, code => code, undefined, null, true);
    const level = buildingLevel(data.buildings.mine!, 2);
    const row = html.split('data-bw="mine"')[1]!.split('</article>')[0]!;
    expect(row).toContain(resChip('metal', level.produces.metal!, { per: 'h' }));
    expect(row).toContain(cost(matchCost(state, level.cost)));
    expect(row).toContain(fmtDur(level.buildTimeHours * 6));
    expect(row).not.toContain('class="bw-fx"');
  });
});

import { beforeAll, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import { productionRequirementsHtml } from './productionRequirementsView';

beforeAll(() => setLocale('ru'));

it('нехватка ресурсов — целыми числами, без хвоста дробной добычи', () => {
  const state = newGame();
  const world = Object.values(state.planets).find((p) => p.owner === 'p1')!;
  const player = state.players.p1!;
  player.resources = Object.fromEntries(Object.keys(player.resources).map((r) => [r, 0.37]));
  const html = productionRequirementsHtml(state, 'p1', world.id, 'building', 'shipyard');
  expect(html).toContain('pw-requirement-row');
  const text = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
  expect(text).not.toMatch(/\d\.\d/);
});

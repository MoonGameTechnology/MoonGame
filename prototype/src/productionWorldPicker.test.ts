import { beforeAll, expect, it } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import { newGame } from './game';
import { productionWorldSelect } from './productionWorldPicker';

beforeAll(() => setLocale('ru'));

it('мир с простаивающей верфью подписан «простой», а у выбора горит точка', () => {
  const state = newGame();
  const home = Object.values(state.planets).find((p) => p.owner === 'p1')!;
  const other = Object.values(state.planets).find((p) => p.owner !== 'p1' && p.kind === 'planet')!;
  other.owner = 'p1';
  other.buildings = [{ uid: 'yard', type: 'shipyard', level: 1, hp: 10 }];
  const html = productionWorldSelect(state, home.id, [home, other]);
  expect(html).toContain(`· ${t('production.world.idle')}</option>`);
  expect(html).toContain('pw-idle-dot');
  // Выбранный мир точку не зажигает: его линии и так перед глазами.
  expect(productionWorldSelect(state, other.id, [other])).not.toContain('pw-idle-dot');
});

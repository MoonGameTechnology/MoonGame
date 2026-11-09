/**
 * Приказы мира в окне «Построить» (UIX-10.12): столица, точки удержания и сбора, крепость.
 * Решения у чистых правил (`decisions/worldOrders.ts`, `rallyPoint.ts`, `fortressRaise.ts`),
 * здесь — что ряд предлагает и что каждая кнопка адресует миру, выбранному списком окна.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  createInitialState,
  type GameState,
  type Planet,
} from '../../packages/shared-core/src/index';

beforeAll(() => setLocale('ru'));

const planet = (id: string, owner: string | null, extra: Partial<Planet> = {}): Planet =>
  ({
    id,
    owner,
    kind: 'planet',
    planetType: 'terran',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links: [],
    ...extra,
  }) as Planet;

function world(): GameState {
  const st = createInitialState({ seed: 'orders', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...st,
    capital: { p1: 'C' },
    planets: {
      A: planet('A', 'p1', { buildings: [{ type: 'shipyard', level: 1, hp: 1000 }] }),
      C: planet('C', 'p1'),
      N: planet('N', 'p2'),
    },
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'azure', status: 'active', resources: {} },
    },
  } as unknown as GameState;
}

async function load(stewardTech = false) {
  vi.resetModules();
  vi.doMock('./stewardScreen', () => ({ stewardTechDone: () => stewardTech }));
  (await import('../../localization/runtime')).setLocale('ru');
  return import('./worldOrdersPane');
}

const order = (act: string, arg: string, pid: string) =>
  `data-wo="${act}" data-arg="${arg}" data-pid="${pid}"`;

describe('приказы мира в окне «Построить»', () => {
  it('столицу предлагают своему миру, кроме самой столицы; чужому — ничего', async () => {
    const m = await load();
    const s = world();
    expect(m.worldOrdersHtml(s, 'p1', 'A')).toContain(order('capital', '', 'A'));
    expect(m.worldOrdersHtml(s, 'p1', 'C')).not.toContain('data-wo="capital"');
    expect(m.worldOrdersHtml(s, 'p1', 'N')).toBe('');
  });

  it('точка удержания — с изученным Хранителем; лимит гасит кнопку, снять можно всегда', async () => {
    expect((await load()).worldOrdersHtml(world(), 'p1', 'A')).not.toContain('data-wo="holdpoint"');
    const m = await load(true);
    const s = world();
    expect(m.worldOrdersHtml(s, 'p1', 'A')).toContain(`${order('holdpoint', 'on', 'A')}>`);
    s.players.p1!.stewardHoldPoints = ['C', 'N'];
    expect(m.worldOrdersHtml(s, 'p1', 'A')).toContain(`${order('holdpoint', 'on', 'A')} disabled>`);
    s.players.p1!.stewardHoldPoints = ['A', 'C'];
    expect(m.worldOrdersHtml(s, 'p1', 'A')).toContain(order('holdpoint', 'off', 'A'));
  });

  it('точка сбора — у мира с верфью: «Задать», а заданная — цель, «Сменить» и «Снять»', async () => {
    const m = await load();
    const s = world();
    expect(m.worldOrdersHtml(s, 'p1', 'C')).not.toContain('data-wo="rally"');
    expect(m.worldOrdersHtml(s, 'p1', 'A')).toContain(order('rally', 'pick', 'A'));
    s.rallyPoints = { p1: { A: 'C' } };
    const html = m.worldOrdersHtml(s, 'p1', 'A');
    expect(html).toContain(t('side.world.rally.change'));
    expect(html).toContain(order('rally', 'off', 'A'));
  });
});

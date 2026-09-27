import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  createInitialState,
  type Context,
  type GameState,
} from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { traderView } from '../../decisions/traderView';
import { traderBoxHtml } from './traderScreen';

// Окно торговца экспедиции (решение владельца 2026-09-26, «живой курс»): цена — на самой
// кнопке, кнопка гаснет, когда сделку не провести, курс против базы виден у товара.

const cfg = data.modes.pve_waves!.trader!;
const ctx: Context = { now: 0, data, config: { timeScale: 1, modeId: 'pve_waves' } };
function world(resources: Record<string, number>, trader?: GameState['trader']): GameState {
  const s = createInitialState({ seed: 'ts', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: { me: { id: 'me', name: 'me', faction: 'x', status: 'active', resources } },
    ...(trader ? { trader } : {}),
  };
}
const box = (s: GameState, sel = 'metal', n = 100) =>
  traderBoxHtml(traderView(s, cfg, ctx, 'me', sel, n), cfg, sel, n, '');

beforeAll(() => setLocale('ru'));

describe('окно торговца — разметка', () => {
  it('купить и продать — с ценой выбранного количества на кнопке', () => {
    const v = traderView(world({ credits: 1000, metal: 500 }), cfg, ctx, 'me', 'metal', 100);
    const metal = v.goods.find((g) => g.good === 'metal')!;
    const html = box(world({ credits: 1000, metal: 500 }));
    expect(html).toContain(`Купить 100 за ${metal.buy.credits}`);
    expect(html).toContain(`Продать 100 за ${metal.sell.credits}`);
    expect(html).not.toMatch(/data-tr="(buy|sell)" disabled/);
  });

  it('нечем платить и нечего продать — кнопки гаснут, а цена видна', () => {
    const html = box(world({ credits: 0, metal: 0 }));
    expect(html).toMatch(/data-tr="buy" disabled>Купить 100 за \d+/);
    expect(html).toMatch(/data-tr="sell" disabled>Продать 100 за \d+/);
  });

  it('у товара — запас и курс против базы стрелкой', () => {
    const html = box(
      world({ metal: 250 }, { metal: { shift: 0.12, at: 0 }, energy: { shift: -0.3, at: 0 } }),
    );
    expect(html).toMatch(/data-tr-good="metal">.*<b>250<\/b><i class="tr-shift up">▲12%<\/i>/);
    expect(html).toContain('<i class="tr-shift down">▼30%</i>');
  });

  it('обмен — по кнопке на каждый другой товар, выбранный товар выделен', () => {
    const html = box(world({ credits: 0, metal: 500 }));
    for (const good of Object.keys(cfg.goods).filter((g) => g !== 'metal'))
      expect(html).toContain(`data-tr-swap="${good}"`);
    expect(html).not.toContain('data-tr-swap="metal"');
    expect(html).toContain('class="tr-good on" data-tr-good="metal"');
  });

  it('правило окна называет числа: продажа на 18% дешевле покупки', () => {
    expect(box(world({}))).toContain('Продажа на 18% дешевле покупки');
  });
});

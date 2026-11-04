import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { marketModule } from './market';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';

// Infinity проходит `>= 1`, а GameState хранится как JSON, где Infinity → null. Гейт режет
// такую цену схемой, обработчик обязан резать её сам: негейтованный хост зовёт его напрямую.
const data = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const kernel = createKernel([marketModule]);

function world(): GameState {
  const s = createInitialState({ seed: 'mkt', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      a: { id: 'a', name: 'a', faction: 'x', status: 'active', resources: { credits: 1000, metal: 100 } },
    },
  };
}

const list = (payload: Record<string, unknown>) =>
  kernel.applyAction(
    world(),
    { id: 's:a:1', type: 'market.list', playerId: 'a', payload, issuedAt: 0 },
    { now: 0, data },
  );

describe('market.list — только конечные числа', () => {
  it.each([
    ['цена', { side: 'sell', resource: 'metal', amount: 10, price: Infinity }],
    ['количество', { side: 'sell', resource: 'metal', amount: Infinity, price: 2 }],
  ])('бесконечная %s — отказ E_BAD_PAYLOAD', (_name, payload) => {
    const r = list(payload);
    expect(r.ok ? 'ok' : r.code).toBe('E_BAD_PAYLOAD');
  });

  it('обычная заявка по-прежнему проходит', () => {
    expect(list({ side: 'sell', resource: 'metal', amount: 10, price: 2 }).ok).toBe(true);
  });
});

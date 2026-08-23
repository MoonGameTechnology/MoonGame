import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { seatClaimModule } from './seatClaim';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {
    azure: { name: 'Azure', passives: { radarRangeBonus: 10 } },
    crimson: { name: 'Crimson' },
  },
  buildings: {},
  events: {},
  sectorKinds: { planet: { capturable: true, buildable: true, orbit: true } },
  scientists: {
    overseer: { name: 'Overseer' },
    polymath: { name: 'Polymath' },
    tinker: { name: 'Tinker' },
  },
});
const ctx = (now = 0): Context => ({ now, data });

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  name: id,
  faction: 'azure',
  status: 'active',
  resources: { metal: 0 },
  ...over,
});

function world(over: Partial<Player> = {}): GameState {
  const base = createInitialState({ seed: 'seat-claim', version: { data: '0.1.0', manifest: '1' } });
  return { ...base, players: { p1: player('p1', over), p2: player('p2', { faction: 'crimson' }) } };
}

const kernel = createKernel([seatClaimModule]);
const claim = (payload: unknown, playerId = 'p1'): Action => ({
  id: `c:${playerId}:1`,
  type: 'seat.claim',
  playerId,
  payload,
  issuedAt: 0,
});
const apply = (state: GameState, payload: unknown, playerId = 'p1'): ApplyResult =>
  kernel.applyAction(state, claim(payload, playerId), ctx());

const okState = (r: ApplyResult): GameState => {
  if (!r.ok) throw new Error(`ожидался успех, получен ${r.code}`);
  return r.state;
};
const code = (r: ApplyResult): string => (r.ok ? 'ok' : r.code);

describe('seatClaimModule (ENTRY-3)', () => {
  it('записывает дом и совет в своё место', () => {
    const s = okState(apply(world(), { faction: 'crimson', scientists: ['overseer', 'polymath'] }));
    expect(s.players['p1']?.faction).toBe('crimson');
    expect(s.players['p1']?.scientists).toEqual([
      { id: 'overseer', level: 1 },
      { id: 'polymath', level: 1 },
    ]);
    expect(s.players['p1']?.claimedAt).toBe(0);
  });

  it('не мутирует вход (чистота)', () => {
    const input = deepFreeze(world());
    const r = apply(input, { faction: 'crimson', scientists: ['overseer'] });
    expect(r.ok).toBe(true);
    expect(input.players['p1']?.faction).toBe('azure');
    expect(input.players['p1']?.claimedAt).toBeUndefined();
  });

  it('трогает только своё место', () => {
    const s = okState(apply(world(), { faction: 'crimson' }));
    expect(s.players['p2']?.faction).toBe('crimson'); // p2 и был crimson
    expect(s.players['p2']?.claimedAt).toBeUndefined();
  });

  describe('правило 1 — заявить можно один раз', () => {
    it('повторная заявка отклоняется', () => {
      const once = okState(apply(world(), { faction: 'crimson' }));
      expect(code(apply(once, { faction: 'azure' }))).toBe('E_SEAT_CLAIMED');
    });

    it('и дом от повторной заявки не меняется', () => {
      const once = okState(apply(world(), { faction: 'crimson' }));
      const twice = apply(once, { faction: 'azure' });
      expect(twice.ok).toBe(false);
      expect(once.players['p1']?.faction).toBe('crimson');
    });
  });

  describe('правило 2 — дом сверяется с каталогом', () => {
    it('неизвестный дом — отказ, а не тихая запись', () => {
      expect(code(apply(world(), { faction: 'nosuch' }))).toBe('E_UNKNOWN_FACTION');
    });

    it('пустая строка — не дом', () => {
      expect(code(apply(world(), { faction: '' }))).toBe('E_BAD_PAYLOAD');
    });

    it('не строка — не дом', () => {
      expect(code(apply(world(), { faction: 7 }))).toBe('E_BAD_PAYLOAD');
    });
  });

  describe('правило 3 — совет как при создании матча', () => {
    it('больше двух — отказ', () => {
      expect(code(apply(world(), { scientists: ['overseer', 'polymath', 'tinker'] }))).toBe(
        'E_TOO_MANY_SCIENTISTS',
      );
    });

    it('неизвестный учёный — отказ', () => {
      expect(code(apply(world(), { scientists: ['nosuch'] }))).toBe('E_UNKNOWN_SCIENTIST');
    });

    it('повтор — отказ', () => {
      expect(code(apply(world(), { scientists: ['overseer', 'overseer'] }))).toBe(
        'E_DUPLICATE_SCIENTIST',
      );
    });

    it('не массив — отказ', () => {
      expect(code(apply(world(), { scientists: 'overseer' }))).toBe('E_BAD_PAYLOAD');
    });

    it('уровень не берётся из payload — он метапрогресс, а не заявка', () => {
      const s = okState(apply(world(), { scientists: ['overseer'] }));
      expect(s.players['p1']?.scientists).toEqual([{ id: 'overseer', level: 1 }]);
    });
  });

  describe('правило 4 — пустая заявка законна', () => {
    it('без выбора место просто занимается', () => {
      const s = okState(apply(world(), {}));
      expect(s.players['p1']?.claimedAt).toBe(0);
      expect(s.players['p1']?.faction).toBe('azure'); // дом места из расклада
      expect(s.players['p1']?.scientists).toBeUndefined();
    });

    it('пустой совет — законный выбор «без учёных»', () => {
      const s = okState(apply(world(), { scientists: [] }));
      expect(s.players['p1']?.scientists).toEqual([]);
    });
  });

  describe('правило 5 — только своё место', () => {
    it('место, которого нет, — отказ', () => {
      expect(code(apply(world(), { faction: 'azure' }, 'p9'))).toBe('E_UNKNOWN_PLAYER');
    });
  });

  // Частично применённая заявка хуже отказа: место числилось бы заявленным с половиной
  // выбора, и переиграть его уже нельзя (правило 1).
  it('отказ по совету не оставляет применённым дом', () => {
    const s = world();
    const r = apply(s, { faction: 'crimson', scientists: ['nosuch'] });
    expect(r.ok).toBe(false);
    expect(s.players['p1']?.faction).toBe('azure');
    expect(s.players['p1']?.claimedAt).toBeUndefined();
  });

  it('без модуля тип действия неизвестен ядру — изоляция', () => {
    const bare = createKernel([]);
    const r = bare.applyAction(world(), claim({ faction: 'azure' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_UNKNOWN_ACTION');
  });
});

describe('seat.confirm / seat.release (правила 6–7)', () => {
  const confirm = (playerId = 'p1'): Action => ({
    id: `k:${playerId}`,
    type: 'seat.confirm',
    playerId,
    payload: {},
    issuedAt: 0,
  });
  const release = (playerId = 'p1'): Action => ({
    id: `r:${playerId}`,
    type: 'seat.release',
    playerId,
    payload: {},
    issuedAt: 0,
  });
  const claimed = (): GameState => okState(apply(world(), { faction: 'crimson' }));

  it('подтверждение закрепляет место', () => {
    const r = kernel.applyAction(claimed(), confirm(), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players['p1']?.seated).toBe(true);
  });

  it('подтверждать нечего, если места не заявляли', () => {
    const r = kernel.applyAction(world(), confirm(), ctx());
    expect(code(r)).toBe('E_SEAT_UNCLAIMED');
  });

  it('повторное подтверждение безвредно — не отказ', () => {
    const once = okState(kernel.applyAction(claimed(), confirm(), ctx()));
    expect(kernel.applyAction(once, confirm(), ctx()).ok).toBe(true);
  });

  it('неподтверждённая заявка отпускается, и выбор снимается вместе с ней', () => {
    const r = kernel.applyAction(claimed(), release(), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players['p1']?.claimedAt).toBeUndefined();
      expect(r.state.players['p1']?.scientists).toBeUndefined();
    }
  });

  it('после отпускания место можно заявить заново — оно вернулось в оборот', () => {
    const freed = okState(kernel.applyAction(claimed(), release(), ctx()));
    expect(apply(freed, { faction: 'azure' }).ok).toBe(true);
  });

  // Смысл правила 6: дошёл до карты — место твоё, и отобрать его нечем.
  it('ЗАКРЕПЛЁННОЕ место не отпускается', () => {
    const seated = okState(kernel.applyAction(claimed(), confirm(), ctx()));
    expect(code(kernel.applyAction(seated, release(), ctx()))).toBe('E_SEAT_SEATED');
  });

  it('отпускать нечего, если места не заявляли', () => {
    expect(code(kernel.applyAction(world(), release(), ctx()))).toBe('E_SEAT_UNCLAIMED');
  });
});

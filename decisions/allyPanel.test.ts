import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  parseMatchMap,
  setStance,
  type AllyOperation,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import mapJson from '../data/maps/pve-4.json';
import pve3 from '../data/maps/pve-3.json';
import { allyPanelView, linkedAlly } from './allyPanel';

// Панель «Связь с союзником» (PVR-7.5): только после встречи и только в мире с местом
// встречи; статус — из того же плана, по которому ходит бот.

const data = shippedGameData();
const fresh = (): GameState => buildStateFromMap(parseMatchMap(mapJson), data);
function met(): GameState {
  const s = fresh();
  setStance(s, 'p1', 'ally', 'alliance');
  setStance(s, 'swarm', 'ally', 'war');
  setStance(s, 'swarm', 'p1', 'war');
  return { ...s, missionFacts: { contacted: { p1: ['rendezvous'] } } };
}

describe('панель союзника — когда она есть', () => {
  it('до встречи и в главах без союзника панели нет', () => {
    expect(allyPanelView(fresh(), 'p1', data)).toBeNull();
    expect(linkedAlly(buildStateFromMap(parseMatchMap(pve3), data), 'p1')).toBeNull();
  });

  it('после встречи без приказа — своя задача союзника', () => {
    const v = allyPanelView(met(), 'p1', data)!;
    expect(v).toMatchObject({
      ally: 'ally',
      alive: true,
      op: { kind: 'attack', source: 'own', planet: 'station_west' },
    });
  });

  it('приказ игрока — его вид и цель, шаг из плана бота', () => {
    const op: AllyOperation = { by: 'p1', kind: 'guard', planet: 'rendezvous', issuedAt: 0 };
    const v = allyPanelView({ ...met(), allyOps: { ally: op } }, 'p1', data)!;
    expect(v).toMatchObject({
      op: { kind: 'guard', source: 'order', planet: 'rendezvous' },
      step: 'advance',
    });
    expect(v.group).toEqual(['ally_1']);
  });

  it('союзник выбыл — «задача недоступна», а не пустая карточка', () => {
    const s = met();
    const gone = {
      ...s,
      players: { ...s.players, ally: { ...s.players.ally!, status: 'defeated' as const } },
    };
    expect(allyPanelView(gone, 'p1', data)).toMatchObject({
      alive: false,
      step: 'blocked',
      reason: 'no-forces',
    });
  });
});

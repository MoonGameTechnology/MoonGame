// Бот знает чужой гарнизон так же, как игрок на его месте (правило №1 владельца
// 2026-09-16; цели флотов — ponytail-аудит 2026-11-08, владелец выбрал 2026-11-09).
// Флоты бота выбирают цели по `seenGarrison`: свой мир целиком, чужой — живым
// наблюдением или снимком тумана, ничья планета без разведки — по правилу старта.
import { describe, expect, it } from 'vitest';
import { newGame, START_CANDIDATES } from './game';
import { data } from './gameData';
import { openTurn } from './aiTurn/turn';
import { identifiedNodes } from '../../packages/shared-core/src/state/visibility';
import { NEUTRAL_PLANET_MILITIA, type GameState } from '../../packages/shared-core/src/index';

function scene(): { s: GameState; seen: string; unseen: string; neutral: string } {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[5]!, ai: true },
    ],
  });
  const eyes = identifiedNodes(s, 'p2', data);
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);
  const free = Object.values(s.planets)
    .filter((p) => p.owner === null)
    .sort(byId);
  const seen = free.find((p) => eyes.has(p.id))!;
  const unseen = free.find((p) => !eyes.has(p.id))!;
  const neutral = free.find((p) => !eyes.has(p.id) && p.kind === 'planet' && p.id !== unseen.id)!;
  for (const p of [seen, unseen]) {
    p.owner = 'p1';
    p.garrison = [{ unit: 'heavy_infantry', count: 7 }];
  }
  neutral.garrison = [];
  return { s, seen: seen.id, unseen: unseen.id, neutral: neutral.id };
}

const seenBy = (s: GameState, id: string) =>
  openTurn(s, 'p2', 'expand', 'strong', new Set())!.seenGarrison(s.planets[id]!);

describe('бот видит чужой гарнизон только через разведку', () => {
  it('опознанный мир — живое наблюдение', () => {
    const { s, seen } = scene();
    expect(seenBy(s, seen)).toEqual([{ unit: 'heavy_infantry', count: 7 }]);
  });

  it('мир в слепой зоне без разведданных — гарнизон неизвестен, считается пустым', () => {
    const { s, unseen } = scene();
    expect(seenBy(s, unseen)).toEqual([]);
  });

  it('мир в слепой зоне со снимком тумана — гарнизон из снимка', () => {
    const { s, unseen } = scene();
    s.fog = {
      p2: {
        [unseen]: {
          owner: 'p1',
          garrison: [{ unit: 'militia', count: 1 }],
          buildings: [],
          at: s.time,
        },
      },
    };
    expect(seenBy(s, unseen)).toEqual([{ unit: 'militia', count: 1 }]);
  });

  it('ничья планета без разведки — ополчение по правилу старта, а не настоящий гарнизон', () => {
    const { s, neutral } = scene();
    expect(seenBy(s, neutral)).toEqual([{ unit: 'militia', count: NEUTRAL_PLANET_MILITIA }]);
  });
});

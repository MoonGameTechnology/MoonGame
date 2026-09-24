import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../kernel/kernel';
import { heroModule } from '../modules/hero';
import { loadGameData } from '../data/loadGameData';
import type { GameData } from '../data/schemas';
import { createInitialState, type GameState, type Hero } from '../state/gameState';
import type { Action, Context } from '../action/types';
import { knownSkillNodes, nodeInnateTo } from './heroSkills';

// AUD-22 (решение владельца 2026-09-24): узел, чья награда у героя уже есть со старта,
// считается изученным — купить его нельзя, а узлы, которые его требуют, открыты.

describe('AUD-22 — nodeInnateTo', () => {
  const kit = { startAbilities: ['scan'], startPassives: ['rally_beacon', 'swift'] };

  it('узел врождённый, только если ВСЁ, что он даёт, уже в стартовом наборе', () => {
    expect(nodeInnateTo({ grants: { ability: 'scan' } }, kit)).toBe(true);
    expect(nodeInnateTo({ grants: { passive: 'rally_beacon' } }, kit)).toBe(true);
    expect(nodeInnateTo({ grants: { passives: ['rally_beacon', 'swift'] } }, kit)).toBe(true);
    // Хоть одна новая награда — узел продаёт настоящее.
    expect(nodeInnateTo({ grants: { ability: 'scan', passive: 'fresh' } }, kit)).toBe(false);
    expect(nodeInnateTo({ grants: { passives: ['swift', 'fresh'] } }, kit)).toBe(false);
    // Способность и пассивка — разные списки: одноимённая пассивка способность не закрывает.
    expect(nodeInnateTo({ grants: { ability: 'swift' } }, kit)).toBe(false);
  });

  it('ступень без наград, неизвестный узел и герой без архетипа врождёнными не бывают', () => {
    expect(nodeInnateTo({ grants: {} }, kit)).toBe(false);
    expect(nodeInnateTo(undefined, kit)).toBe(false);
    expect(nodeInnateTo({ grants: { ability: 'scan' } }, undefined)).toBe(false);
  });
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const shipped: GameData = loadGameData((name) =>
  JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')),
);

/** Узлы дерева в порядке «родитель раньше ребёнка». */
function parentsFirst(tree: GameData['heroSkillTrees']): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const parent of tree[id]?.requires ?? []) visit(parent);
    out.push(id);
  };
  for (const id of Object.keys(tree).sort()) visit(id);
  return out;
}

/** Мир из одного героя архетипа, засеянного так же, как `buildFromMap`, и богатой казны. */
function heroWorld(archetype: string): GameState {
  const def = shipped.heroes[archetype]!;
  const rich = Object.fromEntries(shipped.resources.map((r) => [r, 1e9]));
  const s = createInitialState({ seed: 'aud-22', version: { data: '0', manifest: '1' } });
  const hero: Hero = {
    id: 'h',
    owner: 'p1',
    location: 'A',
    cooldowns: {},
    alive: true,
    archetype,
    abilities: [...def.startAbilities],
    passives: [...def.startPassives],
  };
  return {
    ...s,
    players: { p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: rich } },
    heroes: { h: hero },
  };
}

describe('AUD-22 — шипнутый каталог: ни одна пара герой × узел не продаёт пустоту', () => {
  const kernel = createKernel([heroModule]);
  const ctx: Context = { now: 0, data: shipped };
  const order = parentsFirst(shipped.heroSkillTrees);
  const loadout = (h: Hero): number => (h.abilities?.length ?? 0) + (h.passives?.length ?? 0);

  for (const archetype of Object.keys(shipped.heroes).sort()) {
    it(`${archetype}: оплаченный узел всегда что-то даёт, врождённый — отклонён бесплатно`, () => {
      const kit = shipped.heroes[archetype];
      const branch = kit?.branch;
      let state = heroWorld(archetype);
      const reachable = new Set<string>();
      let seq = 0;
      for (const node of order) {
        const def = shipped.heroSkillTrees[node]!;
        const open = def.branch === undefined || def.branch === branch;
        if (!open || !def.requires.every((p) => reachable.has(p))) continue;
        reachable.add(node);

        const before = state.heroes!.h!;
        const wallet = JSON.stringify(state.players.p1!.resources);
        const action: Action = {
          id: `s:p1:${++seq}`,
          type: 'hero.skill.unlock',
          playerId: 'p1',
          payload: { heroId: 'h', node },
          issuedAt: 0,
        };
        const r = kernel.applyAction(state, action, ctx);
        if (nodeInnateTo(def, kit)) {
          // Изучен от рождения: отказ, казна не тронута, дети остаются доступны.
          expect(r.ok ? 'ok' : r.code, node).toBe('E_ALREADY_UNLOCKED');
          expect(JSON.stringify(state.players.p1!.resources)).toBe(wallet);
          continue;
        }
        if (!r.ok) throw new Error(`${archetype}/${node}: ${r.code}`);
        state = r.state;
        const { ability, passive, passives = [] } = def.grants;
        const granted = ability !== undefined || passive !== undefined || passives.length > 0;
        // Узел с наградой расширяет набор; ступень без наград (улучшение способности) — нет.
        if (granted) expect(loadout(state.heroes!.h!), node).toBeGreaterThan(loadout(before));
      }
      // Прогон прошёл весь открытый архетипу каталог, а не споткнулся в начале.
      expect(reachable.size).toBeGreaterThan(0);
    });
  }

  it('у Командира и Авангарда врождённые узлы шипнутого дерева названы поимённо', () => {
    // Снимок находки аудита: пары, которые до AUD-22 продавали пустоту.
    const innate = (a: string): string[] => [...knownSkillNodes([], a, shipped)].sort();
    expect(innate('commander')).toEqual(['psi_veil', 'void_attunement']);
    expect(innate('ravager')).toEqual(['psi_veil']);
    expect(innate('vanguard')).toEqual(['neural_lace']);
    expect(innate('warden')).toEqual([]);
    // PVR-6.16: «Разведка» Учёного — награда «Пси-вуали»; узел у него изучен от рождения.
    expect(innate('scientist')).toEqual(['psi_veil']);
  });
});

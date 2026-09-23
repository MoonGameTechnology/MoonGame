/**
 * ROADS-7 — дороги с развилками и на соло-картах прототипа (решение владельца 2026-09-23:
 * «дороги нужны и там»).
 *
 * До этого кирпича ядро водило флоты по дорогам на картах глав, а на `nexus` и
 * `frontier-*` — по прямым: `newGame` собирает соло-партию мимо `buildStateFromMap` и сети
 * не выводил. Два правила движения в одной игре — развилка, засада и обход планеты работали
 * бы в Sector Zero и молча не работали бы в песочнице.
 *
 * 1. **Правило то же, что у карты с авторскими лейнами:** мозаики за ними нет, поэтому
 *    переход — в середине между центрами, а сколько троп выходит от планеты, решает её
 *    местность.
 * 2. **Развилки на этих картах есть** — их обходит флот, и мимо планеты он идёт через них.
 * 3. **Сеть делится, а не копируется** каждым шагом мира: иначе на `frontier-50` шаг
 *    дорожал на четверть, а раунд ИИ — наполовину (замер в `roads-roadmap.md`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { newGame } from './matchSetup';
import { mapPreset } from './mapCatalog';
import { order, moveFleet } from './game';
import { data } from './gameData';
import { deepClone, planRoute, type GameState } from '../../packages/shared-core/src/index';

const MAPS = ['nexus', 'frontier-50'] as const;
const games = new Map<string, GameState>(
  MAPS.map((mapId) => [
    mapId,
    newGame({
      mapId,
      seats: [
        { id: 'p1', name: 'P1', faction: 'azure', start: mapPreset(mapId).starts[0]!, ai: false },
      ],
    }),
  ]),
);
const game = (mapId: string): GameState => games.get(mapId)!;

describe('ROADS-7 — сеть дорог на соло-картах', () => {
  for (const mapId of MAPS) {
    it(`${mapId}: переход один с обеих сторон, в середине лейна; каждый сосед — ровно на одной тропе`, () => {
      const s = game(mapId);
      for (const p of Object.values(s.planets)) {
        const links = p.links ?? [];
        if (links.length === 0) continue;
        expect([p.id, Object.keys(p.roads!.crossings).sort()]).toEqual([p.id, [...links].sort()]);
        expect([p.id, p.roads!.trails.flatMap((t) => t.exits).sort()]).toEqual([
          p.id,
          [...links].sort(),
        ]);
        for (const n of links) {
          const other = s.planets[n]!;
          const x = p.roads!.crossings[n]!;
          expect(other.roads!.crossings[p.id]).toEqual(x);
          expect(x).toEqual({
            x: (p.position.x + other.position.x) / 2,
            y: (p.position.y + other.position.y) / 2,
          });
        }
      }
    });

    it(`${mapId}: развилки есть, и только у местности с числом троп`, () => {
      const s = game(mapId);
      let forks = 0;
      for (const p of Object.values(s.planets)) {
        for (const trail of p.roads?.trails ?? []) {
          if (!trail.fork) continue;
          forks++;
          expect([p.id, data.sectors[p.terrain ?? '']?.corridors]).not.toEqual([p.id, undefined]);
        }
      }
      expect(forks).toBeGreaterThan(0);
    });

    it(`${mapId}: шаг мира делит сеть, а не копирует`, () => {
      const s = game(mapId);
      const id = Object.keys(s.planets).find((k) => s.planets[k]!.roads)!;
      expect(deepClone(s).planets[id]!.roads).toBe(s.planets[id]!.roads);
    });
  }
});

describe('ROADS-7 — на nexus флот обходит планету по развилке', () => {
  it('путь через провинцию с развилкой на тропе идёт мимо её планеты: нога кончается на развилке', () => {
    const s = structuredClone(game('nexus')) as GameState;
    // Провинция B, у которой вход A и выход C лежат на одной тропе с развилкой, и путь A→C
    // идёт через B. Ничья — чтобы проход не упирался в чужую территорию.
    let found: { a: string; b: string; c: string } | null = null;
    for (const p of Object.values(s.planets)) {
      if (p.owner !== null || found) continue;
      for (const trail of p.roads?.trails ?? []) {
        if (!trail.fork || found) continue;
        for (const a of trail.exits)
          for (const c of trail.exits) {
            if (found || a === c) continue;
            const route = planRoute(s, a, c);
            if (route && route.length === 2 && route[0] === p.id) found = { a, b: p.id, c };
          }
      }
    }
    expect(found).not.toBeNull();
    const { a, b, c } = found!;
    s.fleets.t1 = {
      id: 't1',
      owner: 'p1',
      location: a,
      movement: null,
      units: [{ unit: 'scout', count: 1 }],
      traits: [],
    };
    const out = order(s, moveFleet('p1', 't1', c), s.time);
    expect(out.error).toBeUndefined();
    const mv = out.state.fleets.t1!.movement!;
    expect(mv.to).toBe(b);
    expect(mv.endT).toBeDefined();
    expect(mv.endT!).toBeLessThan(1); // к развилке, а не к планете
  });
});

describe('ROADS-7 — состояние из сохранения снова делит сеть', () => {
  it('`installMatch` помечает сеть после JSON — иначе шаги после перезагрузки её копировали бы', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const body = /function installMatch\([^)]*\): void \{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body, 'функция installMatch не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('shareRoadNetwork(s.planets)');
  });
});

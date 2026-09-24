/**
 * ПОБЕДА В ГЛАВЕ — ВЫСТОЯТЬ (PVR-2.5, решение владельца 2026-09-23).
 *
 * Прогон 16 стратегий показал, что прежнее правило — «все волны пришли И у Роя не
 * осталось миров» — на шипнутых главах недостижимо: волны бесплатные, растут ×N и
 * рождаются в мире самого Роя, поэтому к десятой волне у улья стоит весь накопленный
 * штурм. Теперь глава засчитана, если игрок держит мир `holdHours` после последней волны.
 *
 * Здесь закреплены ДАННЫЕ этого правила; вердикт держат модульные тесты ядра
 * (`pveHoldOut.test.ts`), а «защитник проходит главу» — прогон забега (`pveRun.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { estimateTravelHours, type Fleet } from '../packages/shared-core/src/index';
import { pveModeId, pveObjectives, pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { RUN_TRAVEL_SPEED } from '../decisions/runTempo';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => i);

describe('PVR-2.5 — удержание после последней волны', () => {
  for (const mission of chapters) {
    it(`глава ${mission + 1}: срок удержания покрывает подход последней волны к дому`, () => {
      // «Выстоять» значит пережить и ПОСЛЕДНЮЮ волну, а не только дождаться её спавна:
      // срок короче её пути до дома засчитывал бы победу, пока волна ещё в дороге.
      const modeId = pveModeId(mission)!;
      const pve = data.modes[modeId]!.pve!;
      expect(pve.holdHours).toBeDefined();
      const s = pveState(data, mission);
      const npc = Object.values(s.players).find((p) => p.faction === pve.npcFaction)!.id;
      // Волна рождается в мире Роя с наименьшим id — так её ставит `pveModule`.
      const staging = Object.keys(s.planets).filter((id) => s.planets[id]!.owner === npc).sort()[0]!;
      const home = Object.values(s.planets).find((p) => p.owner === 'p1' && p.kind === 'planet')!;
      const wave: Fleet = {
        id: 'last-wave',
        owner: npc,
        location: staging,
        movement: null,
        traits: [],
        units: pve.waveFleet!.map((u) => ({
          unit: u.unit,
          count: u.count * pve.waves,
          ...(u.modules ? { modules: [...u.modules] } : {}),
        })),
      };
      const rules = { data, config: { timeScale: 1, modeId, travelSpeedFactor: RUN_TRAVEL_SPEED } };
      const approach = estimateTravelHours(s, rules, staging, home.id, wave);
      expect(approach).not.toBeNull();
      expect(pve.holdHours!).toBeGreaterThanOrEqual(approach!);
    });
  }

  it('глава 1: у улья своя дополнительная задача — «уничтожить улей»', () => {
    // Решение владельца: зачистка улья перестала быть условием победы и стала задачей с
    // наградой. Цель — мир, который Рой держит на старте.
    const s = pveState(data, 0);
    const hive = pveObjectives(0).find((o) => o.id === 'mission.destroy-hive');
    expect(hive?.kind).toBe('control');
    expect(hive?.targets).toEqual(['hive']);
    expect(s.planets.hive?.owner).toBe('p3');
  });
});

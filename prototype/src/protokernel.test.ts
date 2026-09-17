import { describe, it, expect } from 'vitest';
import { SCORE_LIMIT, kernel } from './game';
import { data } from './gameData';
import { pveState } from '../../packages/client/src/gameData';
import type { Context } from '../../packages/shared-core/src/index';

// Порог победы по очкам — конфиг матча прототипа (`protoKernel.ts`), а не механика
// ядра: `victoryModule` читает его из `ctx.config.victory.scoreLimit`. Проверка жила
// в `tax.test.ts` и переехала сюда вместе со сведением налога в ядро (CONV-3) —
// налоговых тестов у прототипа больше нет, а этот к налогу и не относился.

describe('victory score limit', () => {
  it('sits below the ~60% domination line so the score race can resolve first', () => {
    expect(SCORE_LIMIT).toBe(1100);
    expect(SCORE_LIMIT).toBeLessThan(0.6 * 2410); // 2410 = board base points
  });
});

// PVR-0.2. `pveModule` жил в серверном `DEV_MODULES` и отсутствовал в списке прототипа —
// то есть механика волн была написана, покрыта тестами и не могла сработать НИ РАЗУ на
// хосте, где реально играют (тот же класс, что FORT-0.2 и FOG-10). Проверяем не членство
// в массиве, а поведение: модуль в ЭТОМ ядре и делает свою работу, когда вооружён.
describe('pve waves reach the prototype kernel (PVR-0.2)', () => {
  const HOUR = 3_600_000;
  /** Матч под режимом волн: `pveModule` читает `ctx.config.modeId` → `data.modes[id].pve`. */
  const pveCtx: Context = { now: HOUR, data, config: { timeScale: 1, modeId: 'pve_waves' } };

  it('seeds state.pve on the first movement of the clock', () => {
    const r = kernel.advanceTo(pveState(data), pveCtx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pve).toBeDefined();
    expect(r.state.pve!.totalWaves).toBe(data.modes.pve_waves!.pve!.waves);
    // Рой найден по ФРАКЦИИ, а не по флагу `ai` — на карте это место p3 (swarm).
    expect(r.state.pve!.npcPlayerId).toBe('p3');
  });

  it('stays inert in a match whose mode has no pve section', () => {
    const plain: Context = { now: HOUR, data, config: { timeScale: 1, modeId: 'standard' } };
    const r = kernel.advanceTo(pveState(data), plain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.pve).toBeUndefined();
  });
});

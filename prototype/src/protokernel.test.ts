import { describe, it, expect, afterEach } from 'vitest';
import { SCORE_LIMIT, kernel, advance, setMatchMode } from './game';
import { data } from './gameData';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
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

// PVR-1.1. Модуль в ядре ещё не значит «волны идут»: конфиг соло-матча собирался БЕЗ
// `modeId`, поэтому `pveModule` не видел секцию `pve` и молчал, стоя в списке. Режим
// теперь объявляет САМА КАРТА (решение владельца §0.7 `sector-zero-roadmap.md`: поле
// карты как дефолт, а не новая сущность «сцена»), а прототип пинит его на время матча —
// ровно как сервер держит его приватным полем комнаты.
describe('solo launch arms the match mode (PVR-1.1)', () => {
  const HOUR = 3_600_000;
  const WAVE_INTERVAL = 6 * HOUR; // data/modes.json → pve_waves.waveIntervalHours

  // Режим принадлежит МАТЧУ, а не процессу: следующий матч не должен унаследовать чужой.
  afterEach(() => setMatchMode(undefined));

  it('the PvE map declares the mode it is played under', () => {
    expect(pveModeId()).toBe('pve_waves');
  });

  it('a PvE launch grows state.pve with a wave schedule', () => {
    setMatchMode(pveModeId());
    const r = advance(pveState(data), HOUR);
    expect(r.error).toBeUndefined();
    expect(r.state.pve).toBeDefined();
    expect(r.state.pve!.totalWaves).toBe(10);
    // Первая волна якорится на НАЧАЛЕ пролёта часов, а не на его конце: матч стартует
    // в 0, значит она ровно через интервал, сколько бы времени ни промотал хост разом.
    expect(r.state.pve!.nextWaveAt).toBe(WAVE_INTERVAL);
    expect(r.state.scheduled.some((e) => e.type === 'pve.wave')).toBe(true);
  });

  it('the armed mode actually produces a wave, not just a state object', () => {
    setMatchMode(pveModeId());
    const before = Object.keys(pveState(data).fleets).length;
    // Часы гонятся ШАГАМИ, как их гонит хост: первый пролёт заводит расписание, и волна
    // становится due уже для следующего. Одним скачком через весь интервал она бы не
    // наступила — повод планируется ВНУТРИ того же пролёта, то есть задним числом.
    const seeded = advance(pveState(data), HOUR);
    const r = advance(seeded.state, WAVE_INTERVAL + HOUR);
    expect(r.error).toBeUndefined();
    expect(r.state.pve!.waveNumber).toBe(1);
    expect(Object.keys(r.state.fleets).length).toBeGreaterThan(before);
  });

  it('an ordinary solo match grows no state.pve', () => {
    const r = advance(pveState(data), HOUR);
    expect(r.error).toBeUndefined();
    expect(r.state.pve).toBeUndefined();
  });

  it('refuses an unknown mode when the match is armed (fail-secure, not a silent base-rules fallback)', () => {
    expect(() => setMatchMode('no_such_mode')).toThrow(/E_UNKNOWN_MODE/);
  });
});

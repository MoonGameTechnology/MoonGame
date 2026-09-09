import { describe, expect, it } from 'vitest';
import { CLIENT_ACTION_TYPES } from '../../packages/shared-core/src/actions/payloadSchemas';
import { runRehearsal } from './rehearsal';

describe('multiplayer rehearsal', () => {
  it('survives concurrency, duplicate delivery, reconnect and server restart', async () => {
    const report = await runRehearsal({
      players: 2,
      latencyMs: 0,
      persistDelayMs: 0,
      timeoutMs: 5_000,
    });

    expect(report).toMatchObject({
      players: 2,
      actionsAccepted: 2,
      duplicatesPrevented: 1,
      reconnects: 1,
      serverRestarts: 1,
      durableWrites: 2 + CLIENT_ACTION_TYPES.length,
      wireActionTypes: CLIENT_ACTION_TYPES.length,
      hashMismatches: 0,
      fogViolations: 0,
      finalSequence: 2 + CLIENT_ACTION_TYPES.length,
    });
    expect(report.wireActionsApplied + report.wireActionsRejectedByRules).toBe(
      CLIENT_ACTION_TYPES.length,
    );
  });

  // RESIL-5 — «генеральная репетиция»: тот же полный стек (провод, гейт, конверты,
  // квитанции, durable-persist, перезапуск), но мир при этом ЖИВЁТ, а трафик создают
  // боты. Отдельным тестом, потому что прогон выше утверждает ТОЧНЫЕ счётчики действий,
  // а живая фаза их по определению сдвигает.
  it('живёт игровые сутки под ботами: без застоя, без мёртвых писем, без десинка', async () => {
    const report = await runRehearsal({
      players: 2,
      latencyMs: 0,
      persistDelayMs: 0,
      timeoutMs: 20_000,
      gameHours: 24,
      botActionsPerHour: 2,
    });

    expect(report.gameHours).toBe(24);
    // Мир не встал и не подавился: оба сигнала берутся из потока наблюдений комнаты.
    expect(report.stalls).toBe(0);
    expect(report.deadLetters).toBe(0);
    // Сутки жизни не развели клиента с сервером и не показали ему чужое.
    expect(report.hashMismatches).toBe(0);
    expect(report.fogViolations).toBe(0); // счётчик статических фаз — они по-прежнему честны
    // Анти-пустышка: боты действительно играли по проводу, а не молчали сутки.
    expect(report.botActions).toBeGreaterThan(0);
    // И перезапуск в конце по-прежнему поднял мир из durable-снапшота.
    expect(report.serverRestarts).toBe(1);
  }, 60_000);
});

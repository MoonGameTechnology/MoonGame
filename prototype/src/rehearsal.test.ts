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

  // RESIL-6 — три оси достоверности, которых у генералки не было: настоящая база,
  // сон матча без зрителей и невзгоды сети. Про Postgres — отдельный тест ниже.
  it('переживает сон матча и невзгоды сети', async () => {
    const report = await runRehearsal({
      players: 3, // третий нужен «уснувшей вкладке»: спит один, играют остальные
      latencyMs: 0,
      persistDelayMs: 0,
      timeoutMs: 20_000,
      gameHours: 12,
      botActionsPerHour: 2,
      hibernate: true,
      networkTrouble: true,
    });

    // Сеть: приказ потерялся → строгий шлюз увидел разрыв → переподключение вылечило.
    expect(report.droppedOrders).toBe(1);
    expect(report.sequenceGaps).toBe(1);
    expect(report.abruptDrops).toBe(1);
    // Уснувшая вкладка реально проспала дельты, а не «проснулась» на пустом месте:
    // без этого проверка догона `applyDelta` была бы украшением.
    expect(report.backlogDeltas).toBeGreaterThan(0);

    // Сон: матч заснул, проснулся по своему событию и заснул снова — и мир за это
    // время ушёл вперёд, хотя не было подключено НИКОГО.
    expect(report.hibernations).toBe(2);
    expect(report.wakes).toBe(1);
    expect(report.offlineAdvanceMs).toBeGreaterThan(0);

    // И всё это — не ценой расхождения с сервером и не ценой застоя часов.
    expect(report.hashMismatches).toBe(0);
    expect(report.stalls).toBe(0);
    expect(report.deadLetters).toBe(0);
    expect(report.storeKind).toBe('memory');
  }, 90_000);
});

// Postgres — только когда база подана (в CI это сервисный контейнер, локально —
// поднятый вручную кластер). Тот же приём, что у контрактов сторов в
// `packages/server/src/store/store.test.ts`: без базы тест пропускается, а не врёт.
const DB = process.env.DATABASE_URL;
describe.skipIf(!DB)('multiplayer rehearsal — настоящий Postgres', () => {
  // Главная ценность здесь не в том, что запись прошла, а в том, что состояние,
  // ПРОЖИВШЕЕ игровые сутки, вернулось из JSONB без потерь. Это единственная
  // исполняемая проверка инварианта «GameState сериализуем»: класс, Map, Date или NaN
  // внутри состояния переживут `deepClone` и все тесты ядра, но круг через базу — нет.
  it('поднимает мир из базы после суток жизни, ничего не потеряв в JSONB', async () => {
    const report = await runRehearsal({
      players: 2,
      latencyMs: 0,
      persistDelayMs: 0,
      timeoutMs: 60_000,
      gameHours: 24,
      botActionsPerHour: 2,
      databaseUrl: DB,
    });

    expect(report.storeKind).toBe('postgres');
    expect(report.jsonbRoundTripOk).toBe(true);
    expect(report.serverRestarts).toBe(1);
    expect(report.durableWrites).toBeGreaterThan(0);
    expect(report.hashMismatches).toBe(0);
    expect(report.stalls).toBe(0);
    expect(report.deadLetters).toBe(0);
  }, 120_000);
});

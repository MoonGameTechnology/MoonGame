// BRW-0 — сессии хоста наконец РАЗЛИЧАЮТСЯ, и лента это показывает.
//
// Труба read-model была готова с BRW-1 (`MatchMeta.modeId` → `MatchSummary.modeId` +
// производный `kind`), но источника у неё не было: прото-хост поднимал все партии одним
// шаблоном, поэтому все три фильтра браузера фильтровали бы по КОНСТАНТЕ. Здесь
// проверяется именно недостающая половина — что метаданные ленты собираются из самой
// сессии, а не из шаблона.
//
// Почему сборка меты живёт в `sessionMeta`, а не остаётся литералом у хоста: тест,
// который собирал бы мету сам, был бы ЗЕРКАЛОМ хоста и зеленел бы при сломанном хосте.
// Ровно та ловушка, из-за которой у прототипа когда-то завёлся второй каталог данных.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '@void/shared-core';
import { MemoryAccountStore } from './store';
import { MatchRegistry, sessionMeta } from './matchRegistry';
import { createDevMatch, loadShippedData } from './scenario';

// Каталог берётся хелпером ПАКЕТА, а не импортом `data/bundle` через `../../../`:
// последний тащит исходники мимо `rootDir` пакета и роняет typecheck сервера.
let data: GameData;
beforeAll(() => {
  data = loadShippedData();
});

/** Комната так, как её рождает хост: режим приезжает в `config` и пинится на матч. */
const session = (id: string, mapId: string, modeId?: string) =>
  createDevMatch(data, {
    id,
    players: ['green', 'red'],
    ...(modeId ? { config: { timeScale: 1, modeId } } : {}),
    mapId,
  });

describe('BRW-0 — мета сессии собирается из самой сессии', () => {
  it('карта берётся из состояния, режим — из резолвнутого конфига комнаты', () => {
    const meta = sessionMeta(session('m', 'frontier-50', 'pve_waves'), {
      timeScale: 1,
      createdAt: 7,
    });
    expect(meta.mapId).toBe('frontier-50');
    expect(meta.modeId).toBe('pve_waves');
  });

  it('сессия без режима не получает `modeId` — «неизвестно», а не выдуманный дефолт', () => {
    // Правило 3 `matchRow.ts`: молчание читается клиентом как «режим неизвестен» и строку
    // НЕ отсеивает. Поставить сюда 'standard' значило бы соврать про старые партии.
    const meta = sessionMeta(session('m', 'nexus'), { timeScale: 1, createdAt: 7 });
    expect(meta.modeId).toBeUndefined();
    expect('modeId' in meta).toBe(false);
  });

  it('карта отсутствует в состоянии (старый снапшот) — падаем на nexus, а не на undefined', () => {
    const room = session('m', 'nexus');
    delete room.state.mapId;
    expect(sessionMeta(room, { timeScale: 1, createdAt: 7 }).mapId).toBe('nexus');
  });

  it('`startedAt` и шкала времени доезжают как есть', () => {
    const meta = sessionMeta(session('m', 'nexus'), {
      timeScale: 100,
      createdAt: 7,
      entryWindowMs: 42,
    });
    expect(meta).toMatchObject({ rules: { timeScale: 100 }, createdAt: 7, entryWindowMs: 42 });
  });

  it('the browser receives the room\'s resolved victory overrides with the host clock scale', async () => {
    const room = createDevMatch(data, {
      id: 'custom-rules',
      mapId: 'duel-1',
      config: { timeScale: 1, modeId: 'standard', victory: { scoreLimit: 777, dominationPercent: 0.8 } },
    });
    const reg = new MatchRegistry(new MemoryAccountStore(), data);
    const meta = sessionMeta(room, { timeScale: 24, createdAt: 7 });
    reg.register(room, meta);
    const [row] = (await reg.list(null)).available;
    expect(row).toMatchObject({
      mapId: 'duel-1',
      rules: {
        timeScale: 24,
        victory: { scoreLimit: 777, dominationPercent: 0.8, coalitionFactor: 0.7 },
      },
    });
    // The browser clock is ×24, but the kernel config is ×1: its cap is 100 game days.
    expect(row?.rules.victory?.endsAt).toBe(100 * 86_400_000);
    meta.rules.victory!.scoreLimit = 1;
    expect(room.victoryRules?.scoreLimit).toBe(777);
  });

  it('the browser receives the evaluator defaults for a room without explicit victory settings', () => {
    expect(sessionMeta(session('m', 'nexus'), { timeScale: 1, createdAt: 7 }).rules).toEqual({
      timeScale: 1,
      victory: {
        scoreLimit: 600,
        dominationPercent: 0.6,
        coalitionFactor: 0.7,
        endsAt: 100 * 86_400_000,
      },
    });
  });

  it.each([
    ['team-2v2', 'team_2v2', 2200],
    ['team-3v3', 'team_3v3', 3300],
  ] as const)('publishes effective team rules omitted by the %s mode preset', (mapId, modeId, scoreLimit) => {
    expect(data.modes[modeId]?.victory?.dominationPercent).toBeUndefined();
    expect(data.modes[modeId]?.victory?.coalitionFactor).toBeUndefined();
    const room = createDevMatch(data, {
      id: mapId,
      mapId,
      config: { timeScale: 1, modeId, victory: { scoreLimit } },
    });
    expect(sessionMeta(room, { timeScale: 24, createdAt: 7 }).rules.victory).toEqual({
      scoreLimit,
      dominationPercent: 0.6,
      coalitionFactor: 0.7,
      endsAt: 100 * 86_400_000,
    });
  });
});

describe('BRW-0 — «Готово, когда»: две сессии различимы в GET /matches', () => {
  it('разные карты → разный mapId; PvE и PvP → разный modeId и kind', async () => {
    const reg = new MatchRegistry(new MemoryAccountStore(), data);
    reg.register(
      session('pvp', 'nexus', 'standard'),
      sessionMeta(session('pvp', 'nexus', 'standard'), { timeScale: 1, createdAt: 2 }),
    );
    reg.register(
      session('pve', 'frontier-50', 'pve_waves'),
      sessionMeta(session('pve', 'frontier-50', 'pve_waves'), { timeScale: 1, createdAt: 1 }),
    );

    const rows = (await reg.list('nobody')).available;
    const by = (id: string) => rows.find((r) => r.matchId === id);
    expect(by('pvp')).toMatchObject({ mapId: 'nexus', modeId: 'standard', kind: 'pvp' });
    expect(by('pve')).toMatchObject({ mapId: 'frontier-50', modeId: 'pve_waves', kind: 'pve' });
    // Собственно предпосылка кирпича: строки РАЗНЫЕ. Пока хост поднимал всё одним
    // шаблоном, оба поля совпадали и фильтровать было нечего.
    expect(by('pvp')!.mapId).not.toBe(by('pve')!.mapId);
    expect(by('pvp')!.modeId).not.toBe(by('pve')!.modeId);
  });
});

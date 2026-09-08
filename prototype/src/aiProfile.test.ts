// СТОРОЖ ПРОФИЛЯ БОТА (AI-BAL-1.1, граница пересмотрена в AIDIFF-1).
//
// Исходное требование владельца (2026-08-26): сильный бот живёт только в прогонах
// баланса, живой игрок встречает прежнего простого. Заказ владельца 2026-09-07 отменил
// ПОЛОВИНУ этого: в ОДИНОЧНОЙ игре сложность соперника выбирает сам игрок — строка бота
// на экране настройки гоняется «выкл → слабый → сильный».
//
// Что осталось нетронутым и стережётся здесь: профиль — это ЧЕТВЁРТЫЙ АРГУМЕНТ
// `aiOrders`, а не поле `GameState`, не настройка матча и не сообщение протокола. Поэтому
// в СЕТЕВОМ матче его нечем подделать: сложность мест там решает сервер, клиенту нечего
// прислать в конверте и нечего подписать в снапшоте. Выбор игрока живёт ровно там, где он
// и так владеет всем процессом, — в собственной соло-игре.
//
// Тесты ниже читают исходники, как i18n-гейт читает их на русские литералы.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { seatAiProfile } from './setupSeats';
import type { Action, GameState } from '../../packages/shared-core/src/index';

/** Харнесы баланса: они обязаны просить сильного бота ЯВНО — иначе прибор мерил бы
 *  слабого и показания разъехались бы с базовой линией блока AI-BAL. */
const LAB_HARNESSES = ['prototype/selfplay.mjs', 'prototype/econplaytest.mjs'];

/** Пути, где сложность НЕ выбирает клиент: сетевой матч ведёт сервер. Прописанный здесь
 *  профиль означал бы, что силу соперника кто-то задаёт с той стороны провода. */
const NET_PATHS = ['prototype/netserver.ts'];

/** Пути, ЗАДАЮЩИЕ правила победы живому игроку: соло-контекст и прото-хост. */
const PLAYER_VICTORY_PATHS = ['prototype/src/protoKernel.ts', 'prototype/netserver.ts'];

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const research = (actions: Action[]): Action[] =>
  actions.filter((a) => a.type === 'technology.research');

describe('профиль бота — сложность соперника', () => {
  it('БЕЗ ПРОФИЛЯ — СЛАБЫЙ: дефолт остаётся прежним простым ботом', () => {
    // Всё, что зовёт `aiOrders` без четвёртого аргумента, получает того же соперника,
    // что и до AIDIFF-1: ветка исследования у него выключена.
    expect(research(aiOrders(game2(), 'p2', 'expand'))).toHaveLength(0);
    expect(research(aiOrders(game2(), 'p2', 'defend'))).toHaveLength(0);
  });

  it('СИЛЬНЫЙ профиль включает эвристику', () => {
    expect(research(aiOrders(game2(), 'p2', 'expand', 'strong')).length).toBeGreaterThan(0);
  });

  it('строка настройки называет ровно эти два профиля', () => {
    // Единственный путь, которым выбор игрока доходит до бота: роль места → профиль.
    expect(seatAiProfile('ai')).toBe('weak');
    expect(seatAiProfile('ai-strong')).toBe('strong');
  });

  it('явный weak ведёт себя как отсутствующий профиль', () => {
    // Сравниваем ТИП+payload, а не действия целиком: `id` несёт сквозной счётчик
    // (`ui:p2:9` / `ui:p2:12`), который растёт между вызовами и к профилю отношения
    // не имеет — сравнение объектов целиком падало бы на нём, а не на поведении.
    const shape = (actions: Action[]): string =>
      JSON.stringify(actions.map((a) => [a.type, a.payload]));
    expect(shape(aiOrders(game2(), 'p2', 'expand', 'weak'))).toBe(
      shape(aiOrders(game2(), 'p2', 'expand')),
    );
  });

  it('СЕТЕВОЙ путь сложность не выбирает (сторож по исходникам)', () => {
    // В сетевом матче силу соперников назначает сервер. Впишет кто-то профиль в вызов
    // прото-хоста — гейт покраснеет здесь, а не в жалобе «у нас боты разной силы».
    for (const path of NET_PATHS) {
      const src = read(path);
      const calls = src.match(/aiOrders\([^)]*\)/g) ?? [];
      for (const call of calls) {
        expect(call, `${path}: сетевой вызов не выбирает сложность`).not.toContain("'strong'");
      }
    }
  });

  it('дефолт в сигнатуре — weak (снимешь дефолт — сложность станет обязательной везде)', () => {
    expect(read('prototype/src/ai.ts')).toContain("profile: AiProfile = 'weak'");
  });

  it('сильный профиль просят ЯВНО: харнесы баланса и соло-драйвер', () => {
    for (const path of LAB_HARNESSES) {
      expect(read(path), `${path}: харнес обязан просить сильного бота явно`).toMatch(
        /aiOrders\([^)]*'strong'\)/,
      );
    }
    // Соло-драйвер сам профиль не выбирает — он передаёт тот, что назначен КРЕСЛУ.
    expect(read('prototype/src/soloDrivers.ts')).toContain(
      "aiOrders(host.state(), ai, 'expand', profile)",
    );
  });

  it('профиль НЕ живёт в состоянии, протоколе и сохранении — по проводу не подделать', () => {
    // То, что уцелело от исходного требования и уцелеть обязано: сложность это аргумент
    // локального вызова, а не сущность матча. В снапшоте её нет, значит в сеть она не
    // уезжает и в сохранении не лежит.
    const s = game2();
    expect(JSON.stringify(s)).not.toContain('aiProfile');
    expect(JSON.stringify(s)).not.toContain('"strong"');
    const payloads = read('packages/shared-core/src/actions/payloadSchemas.ts');
    expect(payloads).not.toContain('aiProfile');
  });
});

// ФИКСИРОВАННАЯ СЕССИЯ — ТОЛЬКО ЛАБОРАТОРИЯ (заказ владельца 2026-08-26).
//
// Прогоны баланса идут ровно 14 игровых дней и БЕЗ досрочной победы по очкам: так у всех
// матчей одинаковая длина, и сравнивать можно итоговый СЧЁТ, а не бинарное «выиграл».
// Живого игрока это не касается вовсе — у него прежняя гонка к порогу очков.
//
// Держится это тем же способом, что и профиль бота: разными файлами. Недельный конфиг
// живёт в headless-харнесах, которые в игре не исполняются; правила победы игрока задают
// `protoKernel.ts` (соло) и `netserver.ts` (прото-хост). Тесты ниже стерегут обе стороны
// границы — чтобы «лабораторная» сессия не переехала в игру незамеченной.
describe('правила победы — фиксированная сессия только в прогонах баланса', () => {
  it('ИГРОВЫЕ пути не обрезают сессию и не глушат победу по очкам', () => {
    for (const path of PLAYER_VICTORY_PATHS) {
      const src = read(path);
      expect(src, `${path}: сессия игрока не ограничивается лабораторной`).not.toContain('endsAt');
      expect(src, `${path}: порог очков игрока должен быть достижимым`).not.toContain('100_000_000');
    }
  });

  it('харнесы баланса: сессия ограничена и порог очков недостижим', () => {
    const selfplay = read('prototype/selfplay.mjs');
    expect(selfplay).toContain('const SESSION_DAYS = 14');
    expect(selfplay).toMatch(/endsAt: SESSION_DAYS \* DAY/);
    expect(selfplay).toContain('scoreLimit: 100_000_000');
    expect(read('prototype/econplaytest.mjs')).toContain('scoreLimit: 100_000_000');
  });
});

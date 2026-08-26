// СТОРОЖ ПРОФИЛЯ БОТА (AI-BAL-1.1) — тест-бот не должен доехать до живого игрока.
//
// Требование владельца: расширенные эвристики живут ТОЛЬКО в прогонах баланса. Игрок,
// зашедший в матч, встречает прежнего простого бота и не имеет способа получить
// лабораторного — ни в союзники, ни в противники; в игре тест-ботов не существует вовсе.
//
// Держится это не соглашением, а формой: профиль — ЧЕТВЁРТЫЙ АРГУМЕНТ `aiOrders`, а не
// поле `GameState`, не настройка матча и не сообщение протокола. Значит подделать нечего:
// профиль не пересекает границу процесса, не попадает в снапшот, в сеть и в сохранение.
// Единственный способ сломать гарантию — вписать `'test'` в игровой путь руками, и ровно
// это ловят тесты ниже: они читают исходники, как i18n-гейт читает их на русские литералы.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';

/** Пути, которым лабораторный бот РАЗРЕШЁН: headless-харнесы баланса, без игроков и DOM. */
const LAB_HARNESSES = ['prototype/selfplay.mjs', 'prototype/econplaytest.mjs'];

/** Пути, по которым в матч попадает ЖИВОЙ игрок. Здесь профиля быть не может. */
const PLAYER_PATHS = [
  'prototype/src/soloDrivers.ts', // соло-режим клиента
  'prototype/netserver.ts', // прото-хост: тут играют люди
  'prototype/src/ai.ts', // сам модуль: дефолт обязан быть 'basic'
];

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

describe('профиль бота — тест-бот только в прогонах баланса', () => {
  it('игровой путь получает ПРОСТОГО бота: без профиля исследований нет', () => {
    // Ровно то, что увидит игрок: соло и прото-хост зовут aiOrders без четвёртого
    // аргумента, значит профиль 'basic' и ветка исследования выключена.
    expect(research(aiOrders(game2(), 'p2', 'expand'))).toHaveLength(0);
    expect(research(aiOrders(game2(), 'p2', 'defend'))).toHaveLength(0);
  });

  it('лабораторный профиль включает эвристику', () => {
    expect(research(aiOrders(game2(), 'p2', 'expand', 'test')).length).toBeGreaterThan(0);
  });

  it('явный basic ведёт себя как отсутствующий профиль', () => {
    // Сравниваем ТИП+payload, а не действия целиком: `id` несёт сквозной счётчик
    // (`ui:p2:9` / `ui:p2:12`), который растёт между вызовами и к профилю отношения
    // не имеет — сравнение объектов целиком падало бы на нём, а не на поведении.
    const shape = (actions: Action[]): string =>
      JSON.stringify(actions.map((a) => [a.type, a.payload]));
    expect(shape(aiOrders(game2(), 'p2', 'expand', 'basic'))).toBe(
      shape(aiOrders(game2(), 'p2', 'expand')),
    );
  });

  it('ИГРОВЫЕ пути не запрашивают тест-профиль (сторож по исходникам)', () => {
    // Если кто-то допишет 'test' в netserver или соло-драйвер, гейт покраснеет здесь, а не
    // в жалобе игрока «бот играет странно».
    for (const path of PLAYER_PATHS) {
      const src = read(path);
      const calls = src.match(/aiOrders\([^)]*\)/g) ?? [];
      for (const call of calls) {
        expect(call, `${path}: игровой вызов не должен просить тест-профиль`).not.toContain(
          "'test'",
        );
      }
    }
  });

  it('дефолт в сигнатуре — basic (снимешь дефолт — сломается игровой путь)', () => {
    expect(read('prototype/src/ai.ts')).toContain("profile: AiProfile = 'basic'");
  });

  it('тест-профиль просят ТОЛЬКО харнесы баланса', () => {
    for (const path of LAB_HARNESSES) {
      expect(read(path), `${path}: харнес обязан просить тест-профиль явно`).toMatch(
        /aiOrders\([^)]*'test'\)/,
      );
    }
  });

  it('профиль НЕ живёт в состоянии, протоколе и сохранении — подделать нечего', () => {
    // Главная гарантия требования: тест-бота нельзя «выставить» из игры, потому что в
    // игре нет места, куда его выставляют. Проверяем, что понятие не утекло в GameState
    // и в клиентские схемы действий.
    const s = game2();
    expect(JSON.stringify(s)).not.toContain('aiProfile');
    expect(JSON.stringify(s)).not.toContain('"test"');
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

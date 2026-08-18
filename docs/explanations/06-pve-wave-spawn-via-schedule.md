# 06. Спавн волн через `schedule()`, тактика NPC — нет

**Дата:** 2026-08-18
**Статус:** proposed (планируется, PvE-фундамент Фаза 3)

## Контекст

PvE-режим «волны» (`docs/game-modes-roadmap.md` GM-4.6): игроки кооперативно
переживают N волн NPC-противника (Рой). Каждая волна — спавн флотов у периферии
карты через фиксированный интервал (`waveIntervalHours`).

**Проблема:** спавн волн должен быть детерминированным (реплеируемым,
воспроизводимым — ADR 01), но тактика NPC (куда двигаться, кого атаковать) —
реагирует на живое состояние и недетерминирована. Где граница?

**Альтернативы:**

- **A.** Спавн волн — в ядре через `schedule()` (детерминирован). Тактика NPC —
  на сервере (ADR 05). Разделение по «детерминируемости».
- **B.** Всё в ядре — спавн и тактика через `schedule()`/`on('time.advanced')`.
  Ломает ADR 01 (тактика недетерминирована) и усложняет ядро.
- **C.** Всё на сервере — спавн и тактика в оркестраторе. Ядро не знает про
  волны, `state.pve` нет. Но тогда счётчик волн и условие победы (пережить N)
  — на сервере, не в `victoryModule`, что ломает data-driven победу.

## Решение

**Альтернатива A.** Разделение по детерминируемости:

- **Ядро (`pveModule`):** спавн волн через `schedule()`.
  - `onAction('pve.spawnWave', ...)` — создаёт NPC-флот у периферии карты,
    инкремент `state.pve.waveNumber`.
  - `on('time.advanced', ...)` — планирует следующую волну через
    `h.schedule(now + waveInterval, 'pve.spawnWave', {wave: N+1})`.
  - `state.pve?: { waveNumber, totalWaves, npcPlayerId }` — mode-состояние,
    JSON-сериализуемо (инвариант #2).
  - Первая волна планируется при старте матча (`on('match.started')` или
    первый `time.advanced`).
  - Детерминизм: `schedule(at, type, payload)` — `at` = `ctx.now + interval`,
    `payload` = номер волны. Один seed + timeline → тот же спавн.

- **Сервер (`pveOrchestrator`):** тактика NPC (ADR 05).
  - По тику генерирует действия: `fleet.move`, `fleet.barrage`, `army.load` и т.д.
  - Недетерминирована (зависит от server time и живого state), но это допустимо
    для PvE (не соревновательный режим).

- **Условие победы (`victoryModule`):** кооп-исход в `evaluateVictory`.
  - `state.pve.waveNumber >= totalWaves` + NPC `defeated` →
    `endMatch(h, null, 'pve-cleared')` (победа всех живых людей).
  - Все люди `defeated` → `endMatch(h, npcId, 'pve-failed')`.
  - PvE-чек — первым в `evaluateVictory` (до score/domination), пока без GM-0.2.

## Последствия

**Плюсы:**
- Спавн волн детерминирован — реплей воспроизводим, `hashState` стабилен.
- Счётчик волн и условие победы — в ядре, data-driven (через `GameModeDef.pve`).
- Тактика NPC — гибкая, на сервере, без ограничений детерминизма.
- Чёткая граница: «что должно быть реплеируемо» (спавн) vs «что реагирует на
  живое состояние» (тактика).

**Цена:**
- Два места логики PvE: `pveModule` (ядро) + `pveOrchestrator` (сервер).
- Реплей PvE-матча: спавн воспроизводим из seed+timeline, тактика NPC — из
  записанных действий (не из seed).
- `state.pve` — новое поле в `GameState`, JSON-сериализуемо (инвариант #2).

**Совместимость:** ADR 01 (ядро чистое), ADR 05 (AI на сервере), ADR 02 (через
шину — `pve.spawnWave` action, `time.advanced` event), ADR 03 (конфиг волн в
`data/modes/pve_waves.json`).

**Ссылки:** `docs/game-modes-roadmap.md` GM-4.6; `packages/shared-core/src/kernel/module.ts`
(`schedule`); ADR 05.
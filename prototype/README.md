# Void Dominion — playable prototype

A first **playable** slice that drives the real `@void/shared-core` simulation
(kernel + all base modules + zod-validated data) in the browser. It is a
throwaway demo to _see and feel_ the core, not the Stage-4 client.

## Play

Open the built file in any browser — no server needed:

```bash
pnpm run prototype          # самодостаточные HTML-файлы игровых экранов
# then open prototype/dist/void-dominion.html
# Sector Zero: prototype/dist/sector-zero.html
```

Ядро, UI и ресурсы вшиты esbuild в каждый игровой HTML; сервер для локального
запуска не нужен. `sector-zero.html` открывает собственное меню с продолжением,
подготовкой корабельных сетов, героями и навыками. Это прямой вход общего клиента,
а не окончательная изолированная сборка продукта.

### How to play

- **Real-time:** the world runs continuously. Top bar: ⏸ pause · ▶ 2 game-hours/sec · ⏩ fast.
- Click a **planet** to inspect it; click your **fleet (▲)** then a destination planet to send it.
  Fleets route along the star lanes; running into a hostile fleet or world starts a battle.
- **Shift-drag** a box over several of your fleets to select a task group; click a destination
  planet to move the whole group.
- On **your** planets: build mines/refineries (economy), a **fort** (defense, upgradeable to a
  fortress), and units. Built units join the **garrison**; **Launch fleet** turns a garrison's
  ships + troops into a mobile force.
- Taking a **defended** world needs landing troops (a mobilised **division**) aboard the attacking fleet.
- **Goal:** capture **CRIMSON** (the red capital). You **lose** if **HOME** falls.

## What it exercises

Movement + Dijkstra lane routing, sector buffs/debuffs, a larger linked star map,
fleet selection/task groups, building iconography, the player treasury with
production & upkeep, construction/upgrade of buildings, building HP + the
ground-defense bonus + structural destruction, two-phase orbital→ground capture,
and a small prototype-only `fleet.launch` action (raise a fleet from a garrison —
a natural future addition to the core).

## Files

- `src/game.ts` — data, map, kernel wiring, the `fleet.launch` module, action builders (no DOM).
- `src/main.ts` — canvas rendering, input, the Red AI and the real-time loop.
- `src/smoke.ts` — Node scenario test of the wiring (`node` + esbuild).
- `uitest.mjs` — headless DOM smoke test of the UI bundle.
- `build.mjs` — собирает `src/bootstrap.ts`: `dist/void-dominion.html` (dev),
  `dist/void-dominion-player.html` (игрок) и `dist/sector-zero.html` (тот же профиль
  игрока со своим стартовым экраном). Отдельный `src/admin.ts` собирается в
  `dist/void-dominion-admin.html`.
- `src/sectorZeroMenu.ts`, `src/sectorZeroPreparation.ts`, `sector-zero.css` —
  главное меню Sector Zero и подготовка между забегами; чистая логика профиля —
  `../decisions/sectorZeroProgress.ts`.
- `node prototype/uitest.mjs --sector-zero` — проверка прямого входа и переходов
  подготовки/забега/сохранения на DOM-харнесе, не замена визуальной проверки браузером.

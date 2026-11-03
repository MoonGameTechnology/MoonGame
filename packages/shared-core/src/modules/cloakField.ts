/**
 * Срыв маскировочного поля (SM-4.3). Само правило тумана — `state/cloak.ts`; этот модуль
 * только отмечает, когда флот себя выдал: бой (начало, вступление, каждый залп), залп
 * обстрела и вылет шаттлов с борта. После отметки поле не работает ещё
 * `CLOAK_BREAK_MS`, считая от последнего такого события.
 *
 * Отметка пишется только флоту, который несёт поле, — у остальных флотов состояние не
 * растёт. Модуля нет — поле не срывается ничем, кроме самого боя (`battleId`), то есть
 * деградация мягкая, без падения.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import { CLOAK_BREAK_MS, fleetCloakRating } from '../state/cloak';

function expose(h: HandlerContext, fleetId: unknown): void {
  if (typeof fleetId !== 'string') return;
  const fleet = h.state.fleets[fleetId];
  if (!fleet || fleetCloakRating(fleet, h.ctx.data) <= 0) return;
  fleet.cloakBrokenUntil = Math.max(fleet.cloakBrokenUntil ?? 0, h.ctx.now + CLOAK_BREAK_MS);
}

/** Все флоты боя `battleId` — в порядке id, как и всё остальное в ядре. */
function exposeBattle(h: HandlerContext, battleId: unknown): void {
  if (typeof battleId !== 'string') return;
  for (const id of Object.keys(h.state.fleets).sort()) {
    if (h.state.fleets[id]!.battleId === battleId) expose(h, id);
  }
}

export const cloakFieldModule: GameModule = {
  id: 'cloak-field',
  version: '1.0.0',
  setup(api) {
    api.on('battle.started', (event, h) => exposeBattle(h, (event.payload as { battleId?: unknown }).battleId));
    api.on('battle.joined', (event, h) => exposeBattle(h, (event.payload as { battleId?: unknown }).battleId));
    api.on('combat.round', (event, h) => exposeBattle(h, (event.payload as { battleId?: unknown }).battleId));
    api.on('planet.bombarded', (event, h) => expose(h, (event.payload as { fleetId?: unknown }).fleetId));
    api.on('shuttle.launched', (event, h) => {
      const p = event.payload as { from?: unknown; fromKind?: unknown };
      if (p.fromKind === 'fleet') expose(h, p.from);
    });
  },
};

import type { ModuleSetupApi } from '../../kernel/module';
import type { Hero } from '../../state/gameState';
import type { GameData, ShipSlotType, ModuleDef } from '../../data/schemas';
import { heroFlagshipChoices } from '../../state/heroFlagship';
import { validateInstalled } from '../../util/fitting';
import type { SlotCounts } from '../../util/loadout';
import { moduleAllowed } from '../../util/loadout';

export function registerHeroFlagship(
  api: ModuleSetupApi,
  slotsOf: (hero: Hero, unit: string, data: GameData) => SlotCounts,
): void {
  api.onAction('hero.flagship', (action, h) => {
    const p = action.payload as { heroId?: string; unit?: string; modules?: string[] };
    if (
      typeof p.heroId !== 'string' ||
      typeof p.unit !== 'string' ||
      !Array.isArray(p.modules) ||
      !p.modules.every((id) => typeof id === 'string')
    )
      return h.reject('E_BAD_PAYLOAD');
    const hero = h.state.heroes?.[p.heroId];
    if (!hero || hero.owner !== action.playerId) return h.reject('E_FORBIDDEN');
    if (hero.mobilization) return h.reject('E_HERO_MOBILIZING');
    if (hero.fleetId && h.state.fleets[hero.fleetId]) return h.reject('E_HERO_DEPLOYED');
    if (!heroFlagshipChoices(h.state, hero, h.ctx.data).includes(p.unit))
      return h.reject('E_NOT_OWNED');
    // The atomic hull change may retain/remove fittings, never mint another module.
    if (p.modules.some((id) => !(hero.modules ?? []).includes(id))) return h.reject('E_NOT_OWNED');
    const unit = p.unit;
    const def = h.ctx.data.units[unit]!;
    const slots = slotsOf(hero, unit, h.ctx.data);
    const fit = validateInstalled<ModuleDef>(
      {
        item: (id) => h.ctx.data.modules[id],
        category: (m) => m.slot,
        capacity: (c) => slots[c as ShipSlotType],
        wildcard: def.slots.universal ?? 0,
        allowed: (m) => moduleAllowed(unit, def, m),
      },
      p.modules,
    );
    if (!fit.ok) return h.reject('E_NO_SLOT');
    hero.flagship = unit;
    hero.modules = [...p.modules];
    h.emit('hero.flagship.changed', { owner: hero.owner, heroId: hero.id, unit });
  });
}

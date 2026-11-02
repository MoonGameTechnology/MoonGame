import type { HandlerContext } from '../kernel/module';
import type { Hero, UnitStack, PlayerArsenal } from '../state/gameState';
import { starsOf, rarityOf } from './stacks';
import { constructionModuleSnapshot } from './arsenalLoadout';

export function heroShipStack(h: HandlerContext, hero: Hero, unit: string): UnitStack {
  const stack: UnitStack = { unit, count: 1 };
  const mods = hero.modules;
  if (mods !== undefined && mods.length > 0) {
    stack.modules = [...mods];
    // Звёзды и редкость модулей — из СНИМКА арсенала места, как у верфи (SZE-1.1/5.1):
    // иначе возрождённый корабль героя выходил бы с голыми ★0 (PVR-6.24). Нет снимка
    // (обычный матч) — полей нет, стек байт-в-байт прежний.
    const arsenal = (hero.moduleSnapshot ??= constructionModuleSnapshot(
      mods,
      h.state.players[hero.owner]?.arsenal,
    ));
    const own = starsOf(stack.modules, arsenal?.stars);
    if (own) stack.moduleStars = own;
    const raised = rarityOf(stack.modules, arsenal?.rarity);
    if (raised) stack.moduleRarity = raised;
  }
  return stack;
}

export function rememberHeroModule(hero: Hero, moduleId: string, arsenal?: PlayerArsenal): void {
  const snapshot = (hero.moduleSnapshot ??= constructionModuleSnapshot(hero.modules, arsenal));
  const picked = constructionModuleSnapshot([moduleId], arsenal);
  delete snapshot.stars[moduleId];
  delete snapshot.rarity[moduleId];
  Object.assign(snapshot.stars, picked.stars);
  Object.assign(snapshot.rarity, picked.rarity);
  hero.modules = [...(hero.modules ?? []), moduleId];
}

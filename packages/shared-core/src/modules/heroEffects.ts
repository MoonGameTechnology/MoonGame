/**
 * heroEffects — capability providers for the data-driven hero abilities whose
 * effect is NOT a `heroModule` built-in (`temp_lane`/`annihilate`). The exotic-effect
 * seam is defined by HERO-4: the `hero.ability` dispatcher looks up
 * `capability('hero.effect.<type>')` and hands it the validated cast; a missing
 * provider is `E_NO_EFFECT`. This module holds the providers — new ability effects
 * arrive by adding one here (or in any module), never by touching the kernel/dispatcher.
 *
 * Contract (see `HeroEffect`): the effect runs AFTER the generic gates
 * (ownership / liveness / equipment / cooldown / range / cost) have passed. A plain
 * return commits cost + the `fx:<type>` cooldown; any `h.reject(code)` throws and the
 * kernel discards the whole draft (fail-secure, cost included).
 */
import { hoursToMs } from '../action/types';
import type { GameModule, HandlerContext } from '../kernel/module';
import type { PlanetId } from '../state/gameState';
import { fleetSideDealingHit, fleetSideTakingHit, heroNode } from '../state/heroes';
import { distance } from '../state/route';
import { isAllied, isHostile } from '../util/combat';
import type { HeroEffect } from './hero';

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/**
 * `recall` — instantly bring the hero's ship home to its capital (`Hero.home`, the
 * respawn anchor). A teleport by design: it bypasses travel (like spawn/respawn, which
 * also set a fleet's node directly). Range-0 / untargeted; the 24h cooldown is the cost.
 */
const recall: HeroEffect = ({ heroId, hero, owner }, h) => {
  const fleetId = hero.fleetId;
  const fleet = fleetId !== undefined ? h.state.fleets[fleetId] : undefined;
  if (!fleet) return h.reject('E_HERO_NOT_DEPLOYED'); // nothing to recall (a reserve hero)
  // Can't warp a ship out of an active fight — that would need combat-side surgery.
  if (fleet.battleId != null && h.state.battles[fleet.battleId]) {
    return h.reject('E_FLEET_BUSY');
  }
  const home = hero.home;
  if (home === undefined || !h.state.planets[home]) return h.reject('E_NO_CAPITAL');
  // Already parked idle at the capital → no-op; reject so the cooldown isn't wasted.
  if (fleet.location === home && fleet.movement == null && fleet.edge == null) {
    return h.reject('E_SAME_LOCATION');
  }
  fleet.location = home;
  fleet.movement = null;
  fleet.edge = null; // clear any parked-on-lane state (edge is only valid while unlocated)
  hero.location = home; // the hero's node memory follows its ship (HERO-2)
  h.emit('hero.recalled', { owner, heroId, fleetId, to: home });
};

/**
 * `aura` — a TIME-BOXED combat aura (rally / bulwark). Casting stores a `{bonus, radius,
 * until}` buff on the hero; while live it feeds the `combat.damage` hook below for the
 * owner's fleets within `radius` of the hero's node — the temporary twin of the HERO-5
 * `rally_beacon` passive (which is the same contribution, always-on). Untargeted
 * (range-0), centred on the hero and following it. `params`: `combatBonus` OR
 * `defenseBonus` (both feed the single `combat.damage` hook the combat model exposes),
 * `radius`, `durationHours`.
 */
const aura: HeroEffect = ({ heroId, hero, params, owner }, h) => {
  const p = params;
  const bonus = num(p.combatBonus) || num(p.defenseBonus);
  const radius = num(p.radius);
  const durationHours = num(p.durationHours);
  // Malformed / no-op aura → reject so the player isn't charged the cooldown for nothing.
  if (bonus <= 0 || durationHours <= 0) return h.reject('E_BAD_EFFECT');
  // hoursToMs, not raw MS_PER_HOUR: the aura window must compress with the match
  // timeScale exactly like the `fx:` cooldown it races (hero.ts `after()`).
  const until = h.ctx.now + hoursToMs(h.ctx, durationHours);
  // Prune expired auras on cast (cooldown > duration ⇒ the list stays tiny), then add.
  const live = (hero.activeAuras ?? []).filter((a) => a.until > h.ctx.now);
  live.push({ bonus, radius, until });
  hero.activeAuras = live;
  h.emit('hero.aura', { owner, heroId, bonus, radius, until });
};

/** Σ of `owner`'s living heroes' ACTIVE auras covering a fleet fighting at `at`. Mirrors
 *  HERO-5 `passiveBonus` but for the time-boxed `hero.effect.aura` buffs (`until > now`,
 *  hero within the aura's `radius` of the battle node). Deterministic (insertion order,
 *  addition); expired auras and hero-less matches contribute nothing. */
function auraBonus(h: HandlerContext, owner: string, at: PlanetId): number {
  const heroes = h.state.heroes;
  if (heroes === undefined) return 0;
  const here = h.state.planets[at]?.position;
  if (here === undefined) return 0;
  const now = h.ctx.now;
  let total = 0;
  // Sorted (BF-13): float summation order must not follow JSONB key order.
  for (const id of Object.keys(heroes).sort()) {
    const hero = heroes[id]!;
    // Deployed heroes only, mirroring passiveBonus (bughunt BF-24).
    if (hero.owner !== owner || hero.alive !== true) continue;
    const auras = hero.activeAuras;
    if (auras === undefined || auras.length === 0) continue;
    const node = h.state.planets[heroNode(h.state, hero)]?.position;
    if (node === undefined) continue;
    const d = distance(node, here);
    for (const a of auras) if (a.until > now && d <= a.radius) total += a.bonus;
  }
  return total;
}

/**
 * `reveal` — a TIME-BOXED fog lift (scan). A RANGED cast: the dispatcher has already
 * validated `target` is a node within the ability's range, so this stores a
 * `{center, radius, until}` reveal on the hero. While live it lifts the fog to
 * full-identify detail for every world within `radius` of `center` — but only in the
 * OWNER's own visibility projection (`coverageFor` reads it per-viewer, so it never
 * leaks to rivals). `params`: `radius`, `durationHours`, plus the ladder's optional
 * `weakPointBonus` / `evasionBonus` (see {@link revealZoneFactor}). Malformed / no-op →
 * reject so the cooldown isn't wasted — "no-op" is judged on the FOG lift alone, since
 * that is what every step of the scan still does.
 */
const reveal: HeroEffect = ({ heroId, hero, params, owner, target }, h) => {
  // The range gate guarantees a valid in-range node for a ranged ability; guard anyway.
  if (typeof target !== 'string' || !h.state.planets[target]) return h.reject('E_BAD_PAYLOAD');
  const p = params;
  const radius = num(p.radius);
  const durationHours = num(p.durationHours);
  if (radius <= 0 || durationHours <= 0) return h.reject('E_BAD_EFFECT');
  // Same timeScale rule as the aura window above.
  const until = h.ctx.now + hoursToMs(h.ctx, durationHours);
  // PSI-LADDER: the hero's own step decides whether this scan also fights. Strictly
  // positive knobs only — a zero one is just an unladdered scan, and a NEGATIVE one is
  // dropped rather than stored: a "bonus" must never help the wrong side. Built once so
  // the stored zone and the event announcing it can't disagree.
  const weakPoints = num(p.weakPointBonus);
  const evasion = num(p.evasionBonus);
  const ladder = {
    ...(weakPoints > 0 ? { weakPoints } : {}),
    ...(evasion > 0 ? { evasion } : {}),
  };
  // Prune expired reveals on cast (cooldown > duration ⇒ the list stays tiny), then add.
  const live = (hero.activeReveals ?? []).filter((r) => r.until > h.ctx.now);
  live.push({ center: target, radius, until, ...ladder });
  hero.activeReveals = live;
  h.emit('hero.revealed', { owner, heroId, center: target, radius, until, ...ladder });
};

/**
 * PSI-LADDER — what the lit zone does to a battle fought inside it, for the fleet side
 * TAKING the hit. Returns the multiplier to apply to that incoming damage.
 *
 * Two independent steps of one ability, both scoped to the same zone and both read from
 * the side taking the hit, so they are the two halves of one question — "who is this,
 * to the hero who lit this zone?":
 *   · `weakPoints` (step 2) — the target is HOSTILE to the scan's owner ⇒ ×(1 + w).
 *   · `evasion`    (step 3) — the target is the owner itself or an ALLY ⇒ ÷(1 + e).
 * Anyone else — neutral, at peace, in a pact — is untouched, which is the point of the
 * step: a scan is not an area attack, it tells YOUR side where to aim.
 *
 * Deterministic: heroes walked in sorted key order, factors multiplied (× commutes, so
 * float order is stable anyway). Reveals of DEAD heroes stop counting — the zone is the
 * hero's live radar picture, exactly like `auraBonus`.
 */
function revealZoneFactor(h: HandlerContext, taking: string, at: PlanetId): number {
  const heroes = h.state.heroes;
  if (heroes === undefined) return 1;
  const here = h.state.planets[at]?.position;
  if (here === undefined) return 1;
  const now = h.ctx.now;
  let factor = 1;
  // Sorted (BF-13): float composition order must not follow JSONB key order.
  for (const id of Object.keys(heroes).sort()) {
    const hero = heroes[id]!;
    if (hero.alive !== true) continue;
    const reveals = hero.activeReveals;
    if (reveals === undefined || reveals.length === 0) continue;
    const owner = hero.owner;
    // Asked ONCE per hero, not per reveal: the relation can't differ between two scans
    // of the same hero. Neither flag ⇒ neutral to this scan (at peace, in a pact, a
    // bystander), and both steps below simply fall through.
    const hostile = isHostile(h, owner, taking);
    const friendly = owner === taking || isAllied(h, owner, taking);
    for (const r of reveals) {
      if (r.until <= now) continue;
      const center = h.state.planets[r.center]?.position;
      if (center === undefined || distance(center, here) > r.radius) continue;
      if (hostile && r.weakPoints !== undefined) factor *= 1 + r.weakPoints;
      if (friendly && r.evasion !== undefined) factor /= 1 + r.evasion;
    }
  }
  return factor;
}

export const heroEffectsModule: GameModule = {
  id: 'heroEffects',
  version: '1.1.0',
  setup(api) {
    api.provideCapability<HeroEffect>('hero.effect.recall', recall);
    api.provideCapability<HeroEffect>('hero.effect.aura', aura);
    api.provideCapability<HeroEffect>('hero.effect.reveal', reveal);

    // Time-boxed combat aura → `combat.damage`, composing with the base default and the
    // heroModule contributions (multiple registrants chain; ×-factors commute, so the
    // module order is immaterial). Same side/attacker read as the HERO-5 aura: the buff
    // rides the side DEALING the hit (covers its attack and its return-fire defense).
    api.hook<number>('combat.damage', (base, args, h) => {
      const { battleId, attacker } = (args ?? {}) as { battleId?: string; attacker?: string };
      const hit = fleetSideDealingHit(h.state, battleId, attacker);
      if (!hit || typeof attacker !== 'string') return base;
      const bonus = auraBonus(h, attacker, hit.battle.location);
      return bonus !== 0 ? base * (1 + bonus) : base;
    });

    // PSI-LADDER → `combat.damage`, keyed off the side TAKING the hit (`args.defender`)
    // rather than the one dealing it: both steps are about what happens to a fleet
    // standing in a lit zone. A separate registrant from the aura hook above on purpose
    // — different side, different question; ×-factors commute, so the two compose in
    // any order.
    api.hook<number>('combat.damage', (base, args, h) => {
      const { battleId, defender } = (args ?? {}) as { battleId?: string; defender?: string };
      const hit = fleetSideTakingHit(h.state, battleId, defender);
      if (!hit || typeof defender !== 'string') return base;
      const factor = revealZoneFactor(h, defender, hit.battle.location);
      return factor !== 1 ? base * factor : base;
    });
  },
};

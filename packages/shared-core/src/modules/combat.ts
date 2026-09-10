import type { GameModule, HandlerContext } from '../kernel/module';
import type { Battle, CombatantRef, Fleet, Planet, PlanetId, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { hoursToMs, type Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';
import { requireOwnedIdleFleet } from '../util/fleet';
import { effectiveStats } from '../util/loadout';
import { isCapturable } from '../state/sectorKind';
import {
  applyDamageToSide,
  INTERCEPT_TOL,
  isHostile,
  laneOccupancy,
  MAX_COMBAT_ROUNDS,
  ownFleet,
  posAt,
  sideAlive,
  sideDamage,
  sideUnits,
} from '../util/combat';

/** Keep a pinned crossing point off the lane's endpoints (avoids a degenerate
 *  node-equivalent edge); mirrors movement's own EPS. */
const EDGE_EPS = 1e-4;

const roundIntervalMs = (ctx: Context): number => hoursToMs(ctx, 1);

// --- retreat -----------------------------------------------------------------

/** The price of disengaging: each stack sheds `RETREAT_TOLL` of its CURRENT hull
 *  and shield pools (see `applyRetreatToll`) — pulling out of a fight is never
 *  free, but the toll alone can never finish a fleet off. */
const RETREAT_TOLL = 0.4;
/** How much faster a just-retreated fleet travels while fleeing… */
const RETREAT_HASTE_MULT = 1.5;
/** …and for how long (world-time) the boost lasts. */
const RETREAT_HASTE_MS = 3 * MS_PER_HOUR;

/** Apply the retreat toll to a fleet's ships in place: −40% of the CURRENT hull
 *  and shield pools per stack (not the maximum — a battered fleet loses 40% of
 *  what it has LEFT). The toll alone can therefore never finish a fleet off:
 *  0.6 × a positive pool stays positive, so the carried landing force always
 *  withdraws with its ships. Ships are still lost when the shrunken pool no
 *  longer fills their hulls (Math.ceil keeps the last damaged ship alive). */
function applyRetreatToll(fleet: Fleet, data: GameData): void {
  for (const stack of fleet.units) {
    const def = data.units[stack.unit];
    if (!def) {
      continue;
    }
    const eff = effectiveStats(def, stack, data);
    const effHull = eff.hp ?? 0;
    const perHull = effHull > 0 ? effHull : 1;
    const maxHull = stack.count * perHull;
    const newHull = (1 - RETREAT_TOLL) * (stack.hp ?? maxHull);
    const newCount = newHull <= 0 ? 0 : Math.ceil(newHull / perHull);
    if (newCount <= 0 || newCount > stack.count) continue; // fail-secure: never grow

    const perShield = eff.shield ?? 0;
    if (perShield > 0) {
      const newShield = (1 - RETREAT_TOLL) * (stack.shieldHp ?? stack.count * perShield);
      stack.shieldHp = Math.min(newShield, newCount * perShield); // cap at surviving capacity
    }
    stack.count = newCount;
    stack.hp = newHull;
  }
}

// --- battle lifecycle --------------------------------------------------------

/** Назначить раунд. `immediate` — ПЕРВЫЙ раунд, на самой встрече (CMB-4).
 *
 *  Раньше первый раунд назначался тем же помощником, что и остальные, то есть через
 *  игровой час после столкновения. Защиты у этой задержки не было — она вышла побочно,
 *  из переиспользования, — а цена оказалась игровой: КОНТАКТ БЫЛ БЕСПЛАТНЫМ. Флот
 *  подходил вплотную, оба вставали, и, успев уйти внутри часа, он не получал и не
 *  наносил ни одного выстрела. Решение владельца после плейтеста: обменяться ударами
 *  обязаны при первой же встрече.
 *
 *  Почему «назначить на сейчас», а не позвать раунд встроенно из `startBattle`:
 *  `advanceTo` продолжает крутить цикл и берёт событие, назначенное на текущий миг,
 *  следующей итерацией (`earliestDue`, ветка `at === committed.time`). Значит
 *  цепочка «победил → сцепился со следующим» пойдёт отдельными событиями в порядке
 *  `(at, seq)`, как всё остальное на таймлайне, а не рекурсией внутри одного шага. */
function scheduleTick(h: HandlerContext, battleId: string, immediate = false): void {
  const at = immediate ? h.ctx.now : h.ctx.now + roundIntervalMs(h.ctx);
  h.schedule(at, 'combat.tick', { battleId });
  // Surface the round clock so the client can render a live battle countdown.
  const battle = h.state.battles[battleId];
  if (battle) {
    battle.nextRoundAt = at;
  }
}

/** Lowest-id hostile, alive, unengaged fleet sitting at node `at`.
 *
 *  `except` — тот, с кем сцепляться НЕЛЬЗЯ (CMB-6): им называют напарника по только что
 *  завершённой ничьей. Без него пара, разведённая предохранителем `MAX_COMBAT_ROUNDS`,
 *  тут же начинала тот же бой заново, и предохранитель терял смысл. */
function findEnemyFleetAt(
  h: HandlerContext,
  at: string,
  owner: string,
  excludeId: string,
  except?: string | null,
): Fleet | null {
  let best: Fleet | null = null;
  for (const id of Object.keys(h.state.fleets)) {
    const f = h.state.fleets[id];
    if (!f || f.id === excludeId || f.id === except || f.location !== at || f.battleId) {
      continue;
    }
    if (!f.units.some((s) => s.count > 0) || !isHostile(h, owner, f.owner)) {
      continue;
    }
    if (best === null || f.id < best.id) {
      best = f;
    }
  }
  return best;
}

/**
 * CMB-7. Перестали ли стороны боя быть враждебными.
 *
 * Ничейный гарнизон (`owner === null`) сюда не попадает: у него нет стойки, спрашивать
 * её не у кого, и бой с ним не прекращается ничем, кроме исхода. Fail-secure: неизвестно
 * — значит НЕ перемирие, бой продолжается.
 */
function ceasefired(h: HandlerContext, battle: Battle): boolean {
  const a = battle.attacker.owner;
  const b = battle.defender.owner;
  if (a === null || b === null) return false;
  return !isHostile(h, a, b);
}

/** Pulls a fleet out of transit and pins it at a node (it now fights/holds). */
function pinToNode(fleet: Fleet, at: string): void {
  fleet.location = at;
  fleet.movement = null;
}

/** Pulls a fleet out of transit and pins it at a continuous point on a lane. */
function pinToEdge(fleet: Fleet, from: PlanetId, to: PlanetId, t: number): void {
  fleet.location = null;
  fleet.movement = null;
  fleet.edge = { from, to, t };
}

function startBattle(h: HandlerContext, battle: Battle): void {
  h.state.battles[battle.id] = battle;
  for (const side of [battle.attacker, battle.defender]) {
    // Стороны, которые держит МИР (гарнизон и плацдарм), не привязаны к флоту:
    // запирать и останавливать нечего.
    if (side.ref.kind !== 'garrison' && side.ref.kind !== 'beachhead') {
      const f = h.state.fleets[side.ref.fleetId];
      if (f) {
        f.battleId = battle.id;
        f.movement = null; // engaging stops a moving fleet
      }
    }
  }
  h.emit('battle.started', {
    battleId: battle.id,
    location: battle.location,
    phase: battle.phase,
    attacker: battle.attacker.owner,
    defender: battle.defender.owner,
  });
  scheduleTick(h, battle.id, true); // CMB-4: первый залп — на самой встрече
}

/**
 * Auto-resolves a fleet-vs-fleet collision at node `at`: a hostile enemy fleet
 * sharing the node always triggers an orbital battle (even mid-journey — it pins
 * the fleet and cancels the rest of its move). Taking the planet itself is a
 * separate, deliberate act from orbit (`fleet.assault`), so simply arriving
 * never captures — the fleet just holds the orbit (a single orbit, GDD §7.4).
 */
function engageFleets(
  h: HandlerContext,
  fleetId: string,
  at: string,
  except?: string | null,
): void {
  const fleet = h.state.fleets[fleetId];
  if (!fleet || fleet.battleId) {
    return;
  }
  const enemy = findEnemyFleetAt(h, at, fleet.owner, fleetId, except);
  if (!enemy) {
    return;
  }
  pinToNode(fleet, at);
  startBattle(h, {
    id: `battle:${h.state.battleSeq++}`,
    location: at,
    phase: 'orbital',
    attacker: { ref: { kind: 'fleet', fleetId: fleet.id }, owner: fleet.owner },
    defender: { ref: { kind: 'fleet', fleetId: enemy.id }, owner: enemy.owner },
    round: 0,
  });
}

/**
 * A ground assault / occupation ordered from the near orbit (`fleet.assault`):
 * storm a defended garrison with the carried landing force, or walk into an
 * undefended hostile/neutral world. Returns a reject code, or null on success
 * (a ground battle was started or the planet was occupied).
 */
function assaultPlanet(h: HandlerContext, fleet: Fleet): string | null {
  const at = fleet.location;
  if (at === null) {
    return 'E_FLEET_BUSY';
  }
  const planet = h.state.planets[at];
  if (!planet) {
    return 'E_NO_PLANET';
  }
  // RULES-3. Пустое пространство захватить нельзя, и раньше это правило жило ТОЛЬКО
  // ниже по течению: приказ проходил, `capturePlanet` молча выходил, и штурм пустоты
  // был «успешным» приказом без единого последствия. Молчаливый no-op противоречит
  // fail-secure (инвариант #4) и делает правило неспрашиваемым: `canApply` отвечал
  // «можно» на то, что заведомо ничего не сделает, поэтому каждый драйвер постоянных
  // приказов держал СВОЮ копию `isCapturable`, чтобы не сыпать пустыми штурмами.
  if (!isCapturable(h.ctx.data, planet)) {
    return 'E_NOT_CAPTURABLE';
  }
  if (planet.owner === fleet.owner) {
    return 'E_OWN_PLANET';
  }
  if (planet.owner !== null && !isHostile(h, fleet.owner, planet.owner)) {
    return 'E_FORBIDDEN'; // an ally's world
  }
  // One ground battle per garrison: two concurrent assaults would SHARE the same
  // garrison defender ref — double return fire, a stale second capture, and the
  // second deposit overwriting the first winner's garrison (bug-hunt MAJOR).
  for (const id of Object.keys(h.state.battles).sort()) {
    const b = h.state.battles[id];
    if (b && b.phase === 'ground' && b.location === at) return 'E_UNDER_ASSAULT';
  }
  // Contested orbit blocks the landing while ANY hostile fleet holds the node —
  // including one locked in a battle. `findEnemyFleetAt` skips battleId fleets (it
  // looks for a fleet TO engage), which let a second attacker start the ground phase
  // while the orbital fight was still undecided — GDD §7.4 is two SEQUENTIAL phases.
  for (const id of Object.keys(h.state.fleets)) {
    const f = h.state.fleets[id];
    if (!f || f.id === fleet.id || f.location !== at) continue;
    if (f.units.some((s) => s.count > 0) && isHostile(h, fleet.owner, f.owner)) {
      return 'E_ORBIT_CONTESTED'; // beat the defending fleet first
    }
  }
  const defended = (planet.garrison ?? []).some((s) => s.count > 0);
  if (defended) {
    if (!(fleet.landing ?? []).some((s) => s.count > 0)) {
      return 'E_NO_TROOPS'; // a defended world needs a landing force
    }
    startBattle(h, {
      id: `battle:${h.state.battleSeq++}`,
      location: at,
      phase: 'ground',
      attacker: { ref: { kind: 'landing', fleetId: fleet.id }, owner: fleet.owner },
      defender: { ref: { kind: 'garrison', planetId: at }, owner: planet.owner },
      round: 0,
    });
    return null;
  }
  capturePlanet(h, at, fleet.id, planet.owner, false); // undefended → occupy
  return null;
}

function capturePlanet(
  h: HandlerContext,
  location: string,
  fleetId: string,
  previousOwner: string | null,
  depositLanding: boolean,
): void {
  const planet = h.state.planets[location];
  const fleet = h.state.fleets[fleetId];
  if (!planet || !fleet) {
    return;
  }
  if (!isCapturable(h.ctx.data, planet)) {
    return; // empty space (sector kind not capturable) can't be owned, even after a fight
  }
  planet.owner = fleet.owner;
  // Only a successful ground assault leaves troops behind to garrison; a fleet
  // simply occupying an undefended world keeps its landing troops aboard.
  if (depositLanding) {
    const landing = fleet.landing ?? [];
    if (landing.some((s) => s.count > 0)) {
      planet.garrison = landing;
      fleet.landing = [];
    }
  }
  // `via` РАЗЛИЧАЕТ СПОСОБ, а не только «прилётом / прочее» (AI-BAL-10). Способов взять мир
  // три: прилететь на ничей (`captureOnArrival` → `'arrival'`), занять необороняемый чужой с
  // орбиты (`'occupy'`) и выиграть наземный бой у живого гарнизона (`'assault'`). Пока
  // событие знало только первый и «все остальные», отчёт харнесса читался наоборот
  // происходящему: с AI-BAL-7 занятие пустого стало массовым, и «захваты штурмом» выросли
  // вчетверо при том, что наземных боёв стало МЕНЬШЕ. Признак берётся из уже имеющегося
  // `depositLanding` — он и есть «был ли наземный бой»: десант остаётся гарнизоном только
  // после выигранного штурма.
  h.emit('planet.captured', {
    planetId: location,
    owner: fleet.owner,
    by: fleetId,
    from: previousOwner,
    via: depositLanding ? 'assault' : 'occupy',
  });
}

/**
 * Захват мира ВЫИГРАВШИМ ПЛАЦДАРМОМ (ROS-1.5) — брат `capturePlanet`, но без флота.
 *
 * Второй копией правил захвата он не является: событие `planet.captured` то же самое и
 * `via: 'assault'` тот же (мир взят наземным боем, а не занят с орбиты), потому что для
 * всех читателей — счёта, харнеса замеров, журнала — это ровно такой же штурм. Разошлось
 * бы только имя виновника: `by` у обычного захвата — id флота, а здесь флота нет, и
 * поэтому там стоит id мира. Врать про несуществующий флот хуже, чем назвать место.
 */
function capturePlanetByBeachhead(
  h: HandlerContext,
  planet: Planet,
  force: { owner: string; units: UnitStack[] },
  previousOwner: string | null,
): void {
  if (!isCapturable(h.ctx.data, planet)) {
    return; // пустое пространство не принадлежит никому, даже после выигранного боя
  }
  planet.owner = force.owner;
  planet.garrison = force.units.filter((s) => s.count > 0);
  h.emit('planet.captured', {
    planetId: planet.id,
    owner: force.owner,
    by: planet.id,
    from: previousOwner,
    via: 'assault',
  });
}

function releaseOrDestroyFleet(h: HandlerContext, ref: CombatantRef): void {
  if (ref.kind === 'garrison' || ref.kind === 'beachhead') {
    return; // стороны без флота — освобождать и уничтожать нечего
  }
  const fleet = h.state.fleets[ref.fleetId];
  if (!fleet) {
    return;
  }
  if (fleet.units.length === 0) {
    h.emit('fleet.destroyed', { fleetId: fleet.id, owner: fleet.owner });
    delete h.state.fleets[fleet.id];
  } else {
    fleet.battleId = null; // released, free to move again
  }
}

/**
 * Чем кончился бой:
 *  · `decided`   — обычный исход, победитель тот, кто остался жив;
 *  · `stalemate` — предохранитель `MAX_COMBAT_ROUNDS`: обе стороны живы, победителя нет;
 *  · `ceasefire` — стороны перестали быть враждебными (CMB-7).
 *
 * Два последних ведут себя одинаково: победителя нет и цепочки «победитель сцепляется
 * со следующим» не будет. Раньше это был булев `stalemate`; третий смысл в булеве не
 * помещался, а звать перемирие «ничьёй» значило бы соврать и игроку, и журналу.
 */
type BattleEnd = 'decided' | 'stalemate' | 'ceasefire';

function finishBattle(h: HandlerContext, battle: Battle, end: BattleEnd = 'decided'): void {
  const aAlive = sideAlive(h.state, battle.attacker.ref);
  const dAlive = sideAlive(h.state, battle.defender.ref);
  const stalemate = end !== 'decided';
  const winner = stalemate
    ? null
    : aAlive && !dAlive
      ? battle.attacker.owner
      : dAlive && !aAlive
        ? battle.defender.owner
        : null;

  // The battle is over. GROUND survivors (a planet garrison or a fleet's landing
  // troops) return "at rest": clear their transient combat HP pool (a UnitStack with
  // `hp` undefined = full health out of combat, gameState.ts §30-32). This must stay
  // for ground because `findHealthyStack` only matches `hp === undefined`, so stale
  // partial `hp` would make army.load/unload skip those stacks forever.
  //
  // SHIPS (a fleet's `units`) deliberately KEEP their `hp`: hull damage is persistent
  // now — a battered fleet limps (route.ts speed drag) and only mends at a friendly
  // repair base (construction.ts). `applyDamage` reads `stack.hp ?? full`, so a
  // damaged ship simply re-enters its next battle at its current hull.
  for (const ref of [battle.attacker.ref, battle.defender.ref]) {
    if (ref.kind === 'fleet') continue; // ships carry hull + shield damage out of combat
    const survivors = sideUnits(h.state, ref);
    if (survivors) {
      for (const stack of survivors) {
        delete stack.hp;
        delete stack.shieldHp; // ground returns at rest: full hull AND full shield
      }
    }
  }

  // Ground capture must happen BEFORE releaseOrDestroyFleet — a fleet whose
  // ships were lost but whose landing troops won the assault would otherwise be
  // deleted (units.length === 0) before capturePlanet can deposit them as the
  // new garrison. Re-validate against the CURRENT owner: if the world changed hands
  // mid-battle (a concurrent capture path), a stale-owner capture must not fire and
  // must not overwrite the fresh owner's garrison.
  if (battle.phase === 'ground' && aAlive && !dAlive && battle.attacker.ref.kind === 'landing') {
    const planet = h.state.planets[battle.location];
    if (planet && planet.owner === battle.defender.owner) {
      capturePlanet(h, battle.location, battle.attacker.ref.fleetId, planet.owner, true);
    }
  }
  // ПЛАЦДАРМ (ROS-1.5) — тот же захват, только десант держит мир, а не флот. Он
  // ВРЕМЕННЫЙ по определению: чем бы бой ни кончился, поля после него не остаётся —
  // выигравший десант становится гарнизоном, проигравший исчезает вместе с боем.
  // Иначе на карте завелись бы вечные «чужие войска на моей земле», которых в модели
  // нет и заводить которые этот кирпич не стал.
  if (battle.phase === 'ground' && battle.attacker.ref.kind === 'beachhead') {
    const planet = h.state.planets[battle.location];
    const force = planet?.beachhead;
    if (planet && force) {
      if (aAlive && !dAlive && planet.owner === battle.defender.owner) {
        capturePlanetByBeachhead(h, planet, force, battle.defender.owner);
      }
      delete planet.beachhead;
    }
  }

  releaseOrDestroyFleet(h, battle.attacker.ref);
  releaseOrDestroyFleet(h, battle.defender.ref);
  delete h.state.battles[battle.id];
  h.emit('battle.resolved', {
    battleId: battle.id,
    location: battle.location,
    phase: battle.phase,
    winner,
    rounds: battle.round,
    end,
  });

  // CMB-6. Здесь стоял ранний выход «после ничьей не сцеплять НИКОГО», и его причина
  // была верной: иначе та же пара мгновенно начинала бы тот же нулевой бой заново, и
  // предохранитель `MAX_COMBAT_ROUNDS` терял бы смысл.
  //
  // Но сторож оказался ШИРЕ своей причины. Причина — «та же пара», а следствие было
  // «никто вообще»: третий враждебный флот, который всё это время стоял на узле и не мог
  // сцепиться (у всех был `battleId`), оставался нетронутым и после развода — до тех пор,
  // пока кто-нибудь не прилетит. Двое подрались вничью, третий смотрел и остался
  // смотреть.
  //
  // Теперь запрет назван точно: сцепляйся с любым, КРОМЕ напарника по этой ничьей
  // (`except` ниже). Пара расходится, как и расходилась, а третий получает свой бой.
  //
  // Почему хватает исключения на один миг, без памяти в состоянии: автосцепку заводят
  // только внешние поводы — прибытие, транзит, перехват, смена стойки и вот этот финал
  // боя. После возврата отсюда никто не попытается свести эту пару снова, пока в мире
  // что-нибудь не произойдёт, — а тогда это уже новая встреча, а не перезапуск старой.
  const exceptId =
    stalemate && battle.attacker.ref.kind === 'fleet' && battle.defender.ref.kind === 'fleet'
      ? { [battle.attacker.ref.fleetId]: battle.defender.ref.fleetId,
          [battle.defender.ref.fleetId]: battle.attacker.ref.fleetId }
      : {};

  if (battle.phase === 'orbital') {
    // Whichever fleet SURVIVED holds the node — not just the attacker. The victor
    // stays in orbit and stops bombarding (re-issue to resume), and must auto-engage
    // any other hostile fleet idling at the node — one that couldn't engage earlier
    // because every fleet there already had a battleId (findEnemyFleetAt skips
    // battleId fleets). Previously only the attacker-victor re-engaged, so a
    // defender that won left a third hostile fleet coexisting at the node forever.
    // Решённый бой оставляет живым ОДНОГО, ничья и перемирие — обоих, и шанс сцепиться
    // с третьим положен каждому выжившему. Обход по отсортированным id: кто окажется
    // нападающим в следующем бою, не должно зависеть от того, кто в прошлом был
    // атакующим (инвариант детерминизма).
    const survivors = [
      battle.attacker.ref.kind === 'fleet' && aAlive ? battle.attacker.ref.fleetId : null,
      battle.defender.ref.kind === 'fleet' && dAlive ? battle.defender.ref.fleetId : null,
    ]
      .filter((id): id is string => id !== null)
      .sort();
    for (const survivorId of survivors) {
      const f = h.state.fleets[survivorId];
      if (!f) continue;
      f.orbit = 'near';
      f.bombarding = false;
      // Chain into any other defender only when the victor holds a NODE; a lane
      // intercept leaves it parked on the edge (location null) — never teleport it.
      // engageFleets is battleId-guarded, so this starts at most one new battle —
      // и второй выживший, если первый уже сцепился, увидит его занятым.
      if (f.location !== null) {
        engageFleets(h, survivorId, battle.location, exceptId[survivorId]);
      }
    }
  }

  if (battle.phase === 'ground' && battle.attacker.ref.kind === 'landing') {
    // Mirror the orbital victor rule for the GROUND finish: a relief fleet arriving
    // mid-assault could not engage (the assault fleet was battleId-locked), and
    // nothing re-engaged after resolution — hostile fleets coexisted at the node
    // forever (bug-hunt MAJOR). engageFleets no-ops unless both sides are live.
    // Плацдарм сюда не попадает: флота, который надо было бы расцепить, у него нет.
    const f = h.state.fleets[battle.attacker.ref.fleetId];
    if (f && !f.battleId && f.location !== null) {
      engageFleets(h, f.id, battle.location);
    }
  }
}

/**
 * Combat — the MELEE battle module (GDD §7). Battles are stateful entities
 * resolved over real hours, one round per `combat.tick`. Fleets collide at map
 * nodes (a `fleet.transit` mid-journey or a `fleet.arrived` at the destination)
 * or at a lane crossing (`fleet.intercept`, scheduled by the `intercept`
 * module); capture is two sequential phases — orbital then ground (§7.4).
 * Damage runs through the `combat.damage` hook — the shared damage extension point
 * (admiral / tactic / bombardment), carrying `phase` in its args. EVERY firing channel
 * uses it (CORE-DMG-1): the melee round here, planetary AA and bombardment in
 * `orbital`, point-defense in `shuttle` — so a
 * technology bonus or faction passive reaches all of them alike. Only `phase: 'ground'`
 * opens the defender-side mitigations (fort, standing buildings, planet type), so the
 * other channels are scaled by the attacker's bonuses and nothing else. A new firing
 * channel that skips the hook is a bug, and `damageHookScope.test.ts` fails on it.
 * Deaths publish `unit.died`; outcomes publish `battle.resolved` and
 * `planet.captured`.
 *
 * The former monolith is split along the bus seams: the near-orbit layer
 * (AA / bombardment) lives in `orbital`, and the
 * lane-crossing detector in `intercept` — each degrades gracefully on its own.
 */
export const combatModule: GameModule = {
  id: 'combat',
  version: '2.0.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => {
      const { fleetId, at } = event.payload as { fleetId: string; at: string };
      engageFleets(h, fleetId, at);
    });

    api.on('fleet.transit', (event, h) => {
      const { fleetId, at } = event.payload as { fleetId: string; at: string };
      engageFleets(h, fleetId, at);
    });

    /**
     * CMB-5. Вражда началась — стоящие рядом флоты сходятся НЕМЕДЛЕННО.
     *
     * Бой заводили только ПРИБЫТИЕ (`fleet.arrived`/`fleet.transit`), перехват и штурм.
     * То есть «встреча» понималась как движение, и оставалась дыра ровно в другую
     * сторону: флоты уже стоят на одном узле мирно, игрок объявляет войну — и не
     * происходит НИЧЕГО, пока кто-нибудь не сдвинется. Стой хоть сутки.
     *
     * В соло этого не видно: прототип покадрово зовёт `checkFleetClashes`, который
     * выдаёт `fleet.engage` за игрока. То есть правило было, но жило В КЛИЕНТЕ — а на
     * сервере такого цикла нет вовсе. Та же болезнь, что у очереди стройки (BLD-1):
     * соло и сеть играли по разным правилам, и разошлись они молча.
     *
     * Стойку здесь не читаем: `engageFleets` спрашивает `isHostile` у СОСТОЯНИЯ, уже
     * изменённого объявлением. Поэтому смягчение стойки честно ничего не находит, и
     * отдельной ветки «а вот если мир» заводить не нужно.
     */
    api.on('diplomacy.changed', (event, h) => {
      const { a, b } = event.payload as { a?: unknown; b?: unknown };
      if (typeof a !== 'string' || typeof b !== 'string') return;
      // CMB-7: сначала РАСЦЕПИТЬ тех, кто перестал быть врагом, и только потом сцеплять
      // тех, кто им стал. В обратном порядке смягчение стойки на миг оставило бы бой
      // живым, а сцепка увидела бы стороны занятыми.
      for (const id of Object.keys(h.state.battles).sort()) {
        const battle = h.state.battles[id];
        if (battle && ceasefired(h, battle)) finishBattle(h, battle, 'ceasefire');
      }
      // Порядок обхода фиксирован сортировкой: кто из пары окажется атакующим, не
      // должно зависеть от порядка создания флотов (инвариант детерминизма).
      for (const id of Object.keys(h.state.fleets).sort()) {
        const f = h.state.fleets[id];
        if (!f || (f.owner !== a && f.owner !== b)) continue;
        if (!f.location || f.movement || f.battleId) continue;
        engageFleets(h, id, f.location);
      }
    });

    // The crossing instant arrives (scheduled by the `intercept` module):
    // re-validate (both still on the lane, hostile, alive, free) — a re-route
    // since scheduling makes this a stale no-op — then pin both fleets to the
    // meeting point and open an orbital fleet-vs-fleet battle.
    api.on('fleet.intercept', (event, h) => {
      const { a, b } = event.payload as { a: string; b: string };
      const fa = h.state.fleets[a];
      const fb = h.state.fleets[b];
      if (!fa || !fb || fa.battleId || fb.battleId) {
        return;
      }
      if (!isHostile(h, fa.owner, fb.owner)) {
        return;
      }
      if (!fa.units.some((s) => s.count > 0) || !fb.units.some((s) => s.count > 0)) {
        return;
      }
      const oa = laneOccupancy(fa);
      const ob = laneOccupancy(fb);
      if (!oa || !ob || oa.lo !== ob.lo || oa.hi !== ob.hi) {
        return; // one left the lane (re-routed / arrived) — stale intercept
      }
      const sa = posAt(oa, h.ctx.now);
      const sb = posAt(ob, h.ctx.now);
      if (Math.abs(sa - sb) > INTERCEPT_TOL) {
        return; // not actually meeting now — stale
      }
      const t = Math.min(1 - EDGE_EPS, Math.max(EDGE_EPS, (sa + sb) / 2));
      pinToEdge(fa, oa.lo, oa.hi, t);
      pinToEdge(fb, oa.lo, oa.hi, t);
      startBattle(h, {
        id: `battle:${h.state.battleSeq++}`,
        location: t <= 0.5 ? oa.lo : oa.hi, // nearest node — for display / event labels
        phase: 'orbital',
        attacker: { ref: { kind: 'fleet', fleetId: fa.id }, owner: fa.owner },
        defender: { ref: { kind: 'fleet', fleetId: fb.id }, owner: fb.owner },
        round: 0,
      });
    });

    // Land the carried army on the contested world below. A single orbit (GDD §7.4):
    // the fleet must be stationed in that orbit (not in transit / on a lane).
    /**
     * ПЛАЦДАРМ ВЫСАДИЛСЯ (ROS-1.5) — десантный челнок поставил чужие войска на землю
     * обороняемого мира, и с этой секунды за мир идёт наземный бой.
     *
     * Слушателем, а не вызовом из `shuttle.ts`: модули не импортируют друг друга, а
     * правила боя (в том числе «один наземный бой на гарнизон») живут здесь. Нет
     * модуля боя — событие никто не слышит, плацдарм стоит, ядро не падает.
     */
    api.on('beachhead.landed', (event, h) => {
      const { planetId } = event.payload as { planetId?: string };
      if (typeof planetId !== 'string') return;
      const planet = h.state.planets[planetId];
      const force = planet?.beachhead;
      if (!planet || !force) return;
      // Тот же гейт, что у второго штурма: два боя за один гарнизон делили бы одну
      // ссылку защитника — двойной ответный огонь и два захвата подряд.
      for (const id of Object.keys(h.state.battles).sort()) {
        const b = h.state.battles[id];
        if (b && b.phase === 'ground' && b.location === planetId) return;
      }
      startBattle(h, {
        id: `battle:${h.state.battleSeq++}`,
        location: planetId,
        phase: 'ground',
        attacker: { ref: { kind: 'beachhead', planetId }, owner: force.owner },
        defender: { ref: { kind: 'garrison', planetId }, owner: planet.owner },
        round: 0,
      });
    });

    api.onAction('fleet.assault', (action, h) => {
      const { fleetId } = action.payload as { fleetId?: string };
      if (typeof fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = requireOwnedIdleFleet(h, fleetId, action.playerId);
      if (fleet.orbit !== 'near') {
        return h.reject('E_WRONG_ORBIT'); // must be stationed in orbit, not in transit
      }
      const code = assaultPlanet(h, fleet);
      if (code) {
        return h.reject(code);
      }
    });

    // A just-retreated fleet flees faster until its haste window lapses.
    api.hook<number>('fleet.speed', (speed, args, h) => {
      const fleetId = (args as { fleetId?: string }).fleetId;
      const fleet = fleetId ? h.state.fleets[fleetId] : undefined;
      return fleet?.retreatHasteUntil != null && h.ctx.now < fleet.retreatHasteUntil
        ? speed * RETREAT_HASTE_MULT
        : speed;
    });

    // Disengage from an ongoing battle. Only an orbital ship-side can pull out (a
    // landing force mid-assault can't). Toll: −40% of the CURRENT hull & shield;
    // reward: a temporary speed boost to flee. The 1-v-1 battle dissolves and the
    // opponent is freed to give chase. The toll wounds but never kills — leaving
    // orbit OUTSIDE a battle stays free (a plain fleet.move).
    api.onAction('fleet.retreat', (action, h) => {
      const { fleetId } = action.payload as { fleetId?: string };
      if (typeof fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = ownFleet(h.state, fleetId); // own-key — rejects an injected `__proto__`
      // One opaque code for "no such fleet" AND "not your fleet": otherwise a client
      // could enumerate ids and use E_NO_FLEET vs E_FORBIDDEN to confirm the existence
      // of fog-hidden enemy fleets (A06 — reject-code side-channel).
      if (!fleet || fleet.owner !== action.playerId) {
        return h.reject('E_NO_FLEET');
      }
      const battleId = fleet.battleId;
      const battle = battleId != null ? h.state.battles[battleId] : undefined;
      if (battleId == null || !battle) {
        return h.reject('E_NOT_IN_BATTLE');
      }
      const isThisFleet = (ref: CombatantRef): boolean =>
        ref.kind === 'fleet' && ref.fleetId === fleetId;
      if (!isThisFleet(battle.attacker.ref) && !isThisFleet(battle.defender.ref)) {
        return h.reject('E_CANNOT_RETREAT'); // the landing force, not the orbital fleet
      }

      applyRetreatToll(fleet, h.ctx.data);
      fleet.battleId = null;

      // Free the opponent's side (a fleet can pursue; a garrison ref is a no-op),
      // then dissolve the now-one-sided battle.
      const other = isThisFleet(battle.attacker.ref) ? battle.defender.ref : battle.attacker.ref;
      releaseOrDestroyFleet(h, other);
      delete h.state.battles[battleId];

      if (fleet.units.length === 0) {
        // The withdrawal finished off an already-crippled fleet — no escape.
        h.emit('fleet.destroyed', { fleetId, owner: fleet.owner });
        delete h.state.fleets[fleetId];
        h.emit('fleet.retreated', { fleetId, owner: action.playerId, battleId, escaped: false });
        return;
      }
      fleet.retreatHasteUntil = h.ctx.now + RETREAT_HASTE_MS;
      h.emit('fleet.retreated', { fleetId, owner: action.playerId, battleId, escaped: true });
    });

    api.on('combat.tick', (event, h) => {
      const { battleId } = event.payload as { battleId: string };
      const battle = h.state.battles[battleId];
      if (!battle) {
        return; // already resolved
      }
      const data = h.ctx.data;
      if (!sideAlive(h.state, battle.attacker.ref) || !sideAlive(h.state, battle.defender.ref)) {
        finishBattle(h, battle);
        return;
      }
      // CMB-7. Бой идёт, только пока стороны ВРАЖДЕБНЫ. Раньше здесь спрашивали лишь
      // «жива ли сторона», и вражда проверялась ровно один раз — при заведении боя.
      // Значит помирившиеся посреди боя продолжали убивать друг друга до чьей-нибудь
      // смерти: кнопка мира на них не действовала, и это читается как сломанный мир, а
      // не как правило. Здесь — САМО правило (каждый раунд спрашивает заново), а
      // мгновенное применение — в обработчике `diplomacy.changed`: раунд стоит игровой
      // час, и без него перемирие стоило бы ещё одного залпа.
      if (ceasefired(h, battle)) {
        finishBattle(h, battle, 'ceasefire');
        return;
      }

      battle.round += 1;
      if (battle.round > MAX_COMBAT_ROUNDS) {
        finishBattle(h, battle, 'stalemate'); // safety valve
        return;
      }

      // Simultaneous round, from the pre-round state: the aggressor strikes with
      // its attack stat, the defender returns fire with its defense stat only.
      const dmgToDefender = h.hook<number>(
        'combat.damage',
        sideDamage(h.state, battle.attacker.ref, data, 'attack'),
        {
          battleId,
          phase: battle.phase,
          location: battle.location,
          attacker: battle.attacker.owner,
          defender: battle.defender.owner,
        },
      );
      const dmgToAttacker = h.hook<number>(
        'combat.damage',
        sideDamage(h.state, battle.defender.ref, data, 'defense'),
        {
          battleId,
          phase: battle.phase,
          location: battle.location,
          attacker: battle.defender.owner,
          defender: battle.attacker.owner,
        },
      );
      applyDamageToSide(h, battle.defender.ref, dmgToDefender, data, battle.location);
      applyDamageToSide(h, battle.attacker.ref, dmgToAttacker, data, battle.location);
      h.emit('combat.round', {
        battleId,
        round: battle.round,
        phase: battle.phase,
        location: battle.location,
        attacker: battle.attacker.owner,
        defender: battle.defender.owner,
        dmgToAttacker,
        dmgToDefender,
      });

      if (sideAlive(h.state, battle.attacker.ref) && sideAlive(h.state, battle.defender.ref)) {
        scheduleTick(h, battleId);
      } else {
        finishBattle(h, battle);
      }
    });
  },
};

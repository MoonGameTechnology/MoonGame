import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  Battle,
  BattleSide,
  CombatantRef,
  Fleet,
  Planet,
  PlanetId,
  UnitStack,
} from '../state/gameState';
import type { GameData } from '../data/schemas';
import { hoursToMs, type Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';
import { requireOwnedIdleFleet } from '../util/fleet';
import { effectiveStats } from '../util/loadout';
import { isCapturable } from '../state/sectorKind';
import { attackerOf, defenderOf } from '../state/battle';
import { splitVolley } from '../util/volley';
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
  except?: ReadonlySet<string> | null,
): Fleet | null {
  let best: Fleet | null = null;
  for (const id of Object.keys(h.state.fleets)) {
    const f = h.state.fleets[id];
    if (!f || f.id === excludeId || except?.has(f.id) || f.location !== at || f.battleId) {
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
  // MSB-1: спрашиваем ПАРЫ сторон, а не два именованных поля. На двух сторонах это ровно
  // прежнее поведение, а на N — уже верный вопрос: бой жив, пока враждебна хоть одна пара.
  const sides = battle.sides;
  let comparable = 0;
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i]!.owner;
      const b = sides[j]!.owner;
      if (a === null || b === null) continue; // стойки нет — спрашивать не у кого
      comparable += 1;
      if (isHostile(h, a, b)) return false;
    }
  }
  // FAIL-SECURE, и на нём этот обход уже споткнулся один раз: если сравнить было НЕЧЕГО
  // (все пары с ничейной стороной), это НЕ перемирие. Голое `return true` в конце
  // означало бы «неизвестно ⇒ мир» и разводило бы бой с ничейным гарнизоном — ровно то,
  // что запрещает правило «любая неопределённость → отказ, а не тихий проход».
  return comparable > 0;
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
  for (const side of battle.sides) {
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
    attacker: attackerOf(battle)?.owner ?? null,
    defender: defenderOf(battle)?.owner ?? null,
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
/**
 * ВСТУПЛЕНИЕ В ИДУЩИЙ БОЙ (MSB-3) — бой на узле, куда этому флоту есть с кем драться.
 *
 * Орбитальный: наземный бой идёт НА ПОВЕРХНОСТИ, и флот, висящий над ней, в него не
 * вступает — GDD §7.4 держит две ПОСЛЕДОВАТЕЛЬНЫЕ фазы, и смешать их значило бы дать
 * кораблям стрелять по гарнизону в обход высадки.
 *
 * Выбор боя детерминирован сортировкой id: на узле их может оказаться несколько (пары
 * сцепились независимо до этого кирпича), и от порядка обхода состояния исход зависеть
 * не имеет права (инвариант #6).
 */
function runningBattleFor(h: HandlerContext, at: string, owner: string): Battle | null {
  for (const id of Object.keys(h.state.battles).sort()) {
    const b = h.state.battles[id];
    if (!b || b.location !== at || b.phase !== 'orbital') continue;
    const hostile = b.sides.some(
      (side) => side.owner !== null && isHostile(h, owner, side.owner) && sideAlive(h.state, side.ref),
    );
    if (hostile) return b;
  }
  return null;
}

/**
 * Втянуть флот в идущий бой (MSB-3, решение владельца 2026-09-11 «втягивать
 * АВТОМАТИЧЕСКИ»).
 *
 * РОЛЬ новому не назначается заново: правило уже есть и одно на все конструкторы боя —
 * **кто вступает, тот атакующий; кого нашли — обороняющийся.** Так устроены прибытие,
 * перехват, штурм и высадка, и отсюда же ответ на неочевидный случай: летящий выручать
 * союзника вступает АТАКУЮЩИМ, потому что атакует агрессора, и бьёт своим `attack`.
 * Побочное следствие, на которое опирается MSB-2: обороняющийся в бою остаётся ОДИН,
 * значит `dmgToDefender` в `combat.round` по-прежнему сумма всего, что в него прилетело.
 */
function joinBattle(h: HandlerContext, fleet: Fleet, battle: Battle, at: string): void {
  pinToNode(fleet, at);
  fleet.battleId = battle.id;
  battle.sides.push({
    ref: { kind: 'fleet', fleetId: fleet.id },
    owner: fleet.owner,
    role: 'attacker',
  });
  h.emit('battle.joined', {
    battleId: battle.id,
    location: at,
    fleetId: fleet.id,
    owner: fleet.owner,
  });
}

/**
 * Сцепить всех, кому на этом узле есть с кем драться (MSB-3).
 *
 * Выжидание перестаёт быть стратегией: мало втянуть ПРИБЫВШЕГО — надо втянуть и того, кто
 * уже стоял рядом свободным и ждал, пока двое обескровят друг друга (сценарий S3, ровно
 * против него кирпич и заводился). Поэтому узел прочёсывается целиком.
 *
 * Проход повторяется, пока кого-то втягивает: вступивший может оказаться врагом тому, кто
 * прошлым проходом врагов в бою не имел. Число проходов ограничено числом свободных флотов
 * на узле — каждый проход либо втягивает хотя бы одного, либо заканчивает цикл.
 */
function pullInBystanders(h: HandlerContext, at: string): void {
  for (;;) {
    let joined = false;
    // Порядок обхода фиксирован сортировкой: кто вступит раньше, не должно зависеть от
    // порядка создания флотов (инвариант детерминизма #6).
    for (const id of Object.keys(h.state.fleets).sort()) {
      const f = h.state.fleets[id];
      if (!f || f.battleId || f.location !== at) continue;
      if (!f.units.some((st) => st.count > 0)) continue;
      const battle = runningBattleFor(h, at, f.owner);
      if (!battle) continue;
      joinBattle(h, f, battle, at);
      joined = true;
    }
    if (!joined) return;
  }
}

function engageFleets(
  h: HandlerContext,
  fleetId: string,
  at: string,
  except?: ReadonlySet<string> | null,
): void {
  const fleet = h.state.fleets[fleetId];
  if (!fleet || fleet.battleId) {
    return;
  }
  // MSB-3: идущий бой имеет ПРИОРИТЕТ над новой дуэлью. Иначе пятеро прибывших дали бы
  // очередь парных боёв вместо одной свалки, и «третий не вмешивается» вернулось бы
  // чёрным ходом — уже не как решение, а как следствие порядка прибытия.
  const running = runningBattleFor(h, at, fleet.owner);
  if (running) {
    joinBattle(h, fleet, running, at);
    pullInBystanders(h, at);
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
    sides: [
      { ref: { kind: 'fleet', fleetId: fleet.id }, owner: fleet.owner, role: 'attacker' },
      { ref: { kind: 'fleet', fleetId: enemy.id }, owner: enemy.owner, role: 'defender' },
    ],
    round: 0,
  });
  pullInBystanders(h, at);
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
  let joined: Battle | null = null;
  for (const id of Object.keys(h.state.battles).sort()) {
    const b = h.state.battles[id];
    if (b && b.phase === 'ground' && b.location === at) {
      // MSB-4: второй штурм больше не отбивается — он ВСТУПАЕТ в идущий наземный бой
      // своей стороной (решение владельца §0.0 №3 «свой плацдарм у каждого»). Прежний
      // запрет стоял не против совместного штурма, а против ДВУХ БОЁВ за один гарнизон:
      // они делили бы одну ссылку защитника, и тот отвечал бы дважды за раунд и мог быть
      // захвачен дважды подряд. Один бой на гарнизон остаётся — просто сторон в нём
      // больше. Десант адресуется своим флотом, поэтому ссылки не сливаются.
      if (!(fleet.landing ?? []).some((x) => x.count > 0)) return 'E_NO_TROOPS';
      joined = b;
      break;
    }
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
  if (joined) {
    joined.sides.push({
      ref: { kind: 'landing', fleetId: fleet.id },
      owner: fleet.owner,
      role: 'attacker',
    });
    h.emit('battle.joined', { battleId: joined.id, location: at, fleetId: fleet.id, owner: fleet.owner });
    return null;
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
      sides: [
        { ref: { kind: 'landing', fleetId: fleet.id }, owner: fleet.owner, role: 'attacker' },
        { ref: { kind: 'garrison', planetId: at }, owner: planet.owner, role: 'defender' },
      ],
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
  // MSB-1: роли спрашиваются у СПИСКА сторон. Сегодня каждый бой ровно парный (кирпич
  // меняет форму, не правила), поэтому обе роли на месте всегда; их отсутствие означало
  // бы повреждённое состояние — fail-secure закрываем бой и уходим, не гадая.
  const attacker = attackerOf(battle);
  const defender = defenderOf(battle);
  if (!attacker || !defender) {
    delete h.state.battles[battle.id];
    return;
  }
  const aAlive = sideAlive(h.state, attacker.ref);
  const dAlive = sideAlive(h.state, defender.ref);
  const stalemate = end !== 'decided';
  // ПОБЕДИТЕЛЬ НА N СТОРОН (MSB-3). Прежняя таблица истинности спрашивала двоих
  // («жив атакующий и мёртв обороняющийся → атакующий»), и на трёх сторонах называла
  // победителем того, кто просто оказался первым в списке, хотя рядом стоял живой враг.
  // Правило то же самое, произнесённое без двойки: победитель есть, только когда выжил
  // РОВНО ОДИН. На двух сторонах это дословно прежняя таблица.
  const aliveSides = battle.sides.filter((side) => sideAlive(h.state, side.ref));
  const winner = stalemate || aliveSides.length !== 1 ? null : (aliveSides[0]?.owner ?? null);

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
  for (const side of battle.sides) {
    const ref = side.ref;
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
  if (battle.phase === 'ground' && aAlive && !dAlive && attacker.ref.kind === 'landing') {
    const planet = h.state.planets[battle.location];
    if (planet && planet.owner === defender.owner) {
      capturePlanet(h, battle.location, attacker.ref.fleetId, planet.owner, true);
    }
  }
  // ПЛАЦДАРМ (ROS-1.5) — тот же захват, только десант держит мир, а не флот. Он
  // ВРЕМЕННЫЙ по определению: чем бы бой ни кончился, поля после него не остаётся —
  // выигравший десант становится гарнизоном, проигравший исчезает вместе с боем.
  // Иначе на карте завелись бы вечные «чужие войска на моей земле», которых в модели
  // нет и заводить которые этот кирпич не стал.
  let resumeAssaultFor: string | null = null;
  if (battle.phase === 'ground' && battle.sides.some((x) => x.ref.kind === 'beachhead')) {
    const planet = h.state.planets[battle.location];
    if (planet) {
      // МИР ПОЛУЧАЕТ ВЛАДЕЛЕЦ САМОГО РАННЕГО ВЫЖИВШЕГО ПЛАЦДАРМА (MSB-4, решение
      // владельца §0.0 №4 «тому, кто начал штурм»). Порядок списка — порядок высадки,
      // поэтому «первый» читается прямо из состояния, без счёта вклада и без новых
      // полей. «ВЫЖИВШЕГО» — это край, которого вопрос не покрывал и который назван
      // допущением в §0.0 №4: если первый берег выбит, а мир дожал второй, отдавать
      // мир мёртвому значило бы отдать его тому, кого на земле уже нет.
      const alive = (planet.beachheads ?? []).filter((b) => b.units.some((st) => st.count > 0));
      if (!dAlive && alive[0] && planet.owner === defender.owner) {
        capturePlanetByBeachhead(h, planet, alive[0], defender.owner);
      }
      if (!dAlive || alive.length === 0) {
        // Гарнизон пал (мир взят) либо все берега выбиты — поля после боя не остаётся.
        // Иначе на карте завелись бы вечные «чужие войска на моей земле», которых в
        // модели нет: плацдарм ВРЕМЕННЫЙ по определению.
        delete planet.beachheads;
      } else {
        // ГАРНИЗОН ЖИВ, А КТО-ТО НА БЕРЕГУ ЕЩЁ ДЕРЖИТСЯ. Такое стало возможно только с
        // MSB-4: цепочка (§0.0 №5) закрывает бой на ЛЮБОЙ смерти, и раньше эта смерть
        // всегда была концом штурма — штурмующий был один. Теперь гибель одного из
        // десантов не отменяет штурм остальных, поэтому выбитые берега убираются, а
        // уцелевшие остаются и штурм ПРОДОЛЖАЕТСЯ новым боем. Стереть их здесь значило
        // бы отнять у живого десанта землю за то, что рядом погиб союзник.
        planet.beachheads = alive;
        // Перезапуск штурма объявляется НИЖЕ, после удаления этого боя: обработчик
        // `beachhead.landed` ищет идущий наземный бой на мире и, увидев ещё не удалённый,
        // «вступил» бы в бой, который через строку исчезнет, — берег остался бы на земле
        // без боя вовсе.
        resumeAssaultFor = alive[0]?.owner ?? null;
      }
    }
  }

  // Отпускаются ВСЕ стороны, а не пара (MSB-3). Пока сторон было две, `attacker` и
  // `defender` покрывали список целиком; с втягиванием третьего этот же код оставлял
  // ему `battleId`, указывающий на удалённый бой, — а такой флот заперт навсегда: он не
  // ходит, не стреляет и не освобождается, потому что освобождать его больше некому.
  for (const side of battle.sides) releaseOrDestroyFleet(h, side.ref);
  delete h.state.battles[battle.id];
  // Штурм продолжают уцелевшие берега (MSB-4): теперь, когда прежний бой удалён,
  // обработчик заведёт новый и подтянет в него остальные плацдармы.
  if (resumeAssaultFor !== null) {
    h.emit('beachhead.landed', { planetId: battle.location, owner: resumeAssaultFor });
  }
  h.emit('battle.resolved', {
    battleId: battle.id,
    location: battle.location,
    phase: battle.phase,
    winner,
    // MSB-4: победителей может быть НЕСКОЛЬКО — совместный штурм кончается тем, что
    // гарнизон пал, а на земле стоят два союзных десанта. `winner` при этом честно
    // null (он есть, только когда выжил ровно один), и потребитель, знающий лишь его,
    // молча не начислит ничего. Поэтому рядом едет полный список: мир по-прежнему
    // достаётся ПЕРВОМУ (§0.0 №4), а вот трофеи делятся — иначе помощь не окупалась бы
    // вовсе и совместный штурм не имел бы смысла.
    winners: stalemate
      ? []
      : [...new Set(aliveSides.map((x) => x.owner).filter((o): o is string => o !== null))].sort(),
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
  // Запрет на пересцепление после ничьей — тоже по СПИСКУ (MSB-3): не сходиться заново
  // ни с кем из этой ничьей, а не только с напарником по паре. Иначе трое, упёршиеся в
  // предохранитель, тут же начали бы тот же нулевой бой, и `MAX_COMBAT_ROUNDS` потерял
  // бы смысл — ровно та livelock'а, ради которой сторож CMB-6 и стоит.
  const stalemated = new Set<string>(
    stalemate
      ? battle.sides.flatMap((side) => (side.ref.kind === 'fleet' ? [side.ref.fleetId] : []))
      : [],
  );

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
    // Выжившие — ВСЕ живые стороны-флоты (MSB-3, §0.0 №5 «цепочка: выжившие сцепляются
    // заново»). На двух сторонах это прежняя пара дословно.
    const survivors = aliveSides
      .flatMap((side) => (side.ref.kind === 'fleet' ? [side.ref.fleetId] : []))
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
        engageFleets(h, survivorId, battle.location, stalemated);
      }
    }
  }

  if (battle.phase === 'ground' && attacker.ref.kind === 'landing') {
    // Mirror the orbital victor rule for the GROUND finish: a relief fleet arriving
    // mid-assault could not engage (the assault fleet was battleId-locked), and
    // nothing re-engaged after resolution — hostile fleets coexisted at the node
    // forever (bug-hunt MAJOR). engageFleets no-ops unless both sides are live.
    // Плацдарм сюда не попадает: флота, который надо было бы расцепить, у него нет.
    const f = h.state.fleets[attacker.ref.fleetId];
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
        sides: [
          { ref: { kind: 'fleet', fleetId: fa.id }, owner: fa.owner, role: 'attacker' },
          { ref: { kind: 'fleet', fleetId: fb.id }, owner: fb.owner, role: 'defender' },
        ],
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
    /**
     * ИГРОК ВЫБЫЛ — его стороны уходят из боёв (MSB-5, сценарий S18).
     *
     * Выбывание удаляет флоты выбывшего (`victory.ts`), и для морского боя этого
     * хватало. Но плацдарм держит МИР, а не флот: он оставался на земле живой стороной,
     * за которой больше никого нет. Такая сторона не может ни победить, ни проиграть
     * осмысленно — а после MSB-4 она ещё и ЗАХВАТЫВАЛА мир: захват отдаёт его владельцу
     * самого раннего выжившего берега, и «выживший» проверяется по войскам, а не по
     * тому, остался ли в партии игрок.
     *
     * Убирает это МОДУЛЬ БОЯ, услышав событие, а не модуль победы своей рукой: правила
     * боя живут здесь, и `victory` не должен знать ни про плацдармы, ни про стороны
     * (инвариант #3 — только через шину).
     */
    api.on('player.eliminated', (event, h) => {
      const playerId = (event.payload as { playerId?: unknown }).playerId;
      if (typeof playerId !== 'string') return;
      for (const planetId of Object.keys(h.state.planets).sort()) {
        const planet = h.state.planets[planetId];
        if (!planet?.beachheads) continue;
        const left = planet.beachheads.filter((b) => b.owner !== playerId);
        if (left.length === planet.beachheads.length) continue;
        if (left.length > 0) planet.beachheads = left;
        else delete planet.beachheads;
      }
      for (const id of Object.keys(h.state.battles).sort()) {
        const battle = h.state.battles[id];
        if (!battle) continue;
        const left = battle.sides.filter((side) => side.owner !== playerId);
        if (left.length === battle.sides.length) continue;
        // Сторона уходит вместе с игроком, а флот, если он ещё цел, освобождается —
        // иначе он остался бы с `battleId` на бой, в котором его больше нет.
        for (const side of battle.sides) {
          if (side.owner === playerId) releaseOrDestroyFleet(h, side.ref);
        }
        battle.sides = left;
        // Драться стало некому — бой закрывается как перемирие: победителя в нём нет
        // (выбывание не победа), и цепочка «победитель сцепляется со следующим» здесь
        // неуместна.
        if (left.length < 2) finishBattle(h, battle, 'ceasefire');
      }
    });

    api.on('beachhead.landed', (event, h) => {
      const { planetId } = event.payload as { planetId?: string };
      if (typeof planetId !== 'string') return;
      const owner = (event.payload as { owner?: string }).owner;
      const planet = h.state.planets[planetId];
      if (!planet || typeof owner !== 'string') return;
      const force = (planet.beachheads ?? []).find((b) => b.owner === owner);
      if (!force) return;
      const ref: CombatantRef = { kind: 'beachhead', planetId, owner };
      // MSB-4: один наземный бой на гарнизон — ПО-ПРЕЖНЕМУ один (две ссылки на один
      // гарнизон дали бы двойной ответный огонь и два захвата подряд). Но второй десант
      // теперь не отбивается, а ВСТУПАЕТ в этот бой своей стороной — решение владельца
      // §0.0 №3 «свой плацдарм у каждого». Роль та же, что у всех вступающих (MSB-3):
      // атакующий.
      for (const id of Object.keys(h.state.battles).sort()) {
        const b = h.state.battles[id];
        if (!b || b.phase !== 'ground' || b.location !== planetId) continue;
        if (!b.sides.some((x) => x.ref.kind === 'beachhead' && x.ref.owner === owner)) {
          b.sides.push({ ref, owner, role: 'attacker' });
          h.emit('battle.joined', { battleId: b.id, location: planetId, owner });
        }
        return;
      }
      startBattle(h, {
        id: `battle:${h.state.battleSeq++}`,
        location: planetId,
        phase: 'ground',
        sides: [
          { ref, owner: force.owner, role: 'attacker' },
          { ref: { kind: 'garrison', planetId }, owner: planet.owner, role: 'defender' },
        ],
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
      // MSB-1: ищем себя СРЕДИ СТОРОН, а не сверяемся с двумя полями.
      if (!battle.sides.some((side) => isThisFleet(side.ref))) {
        return h.reject('E_CANNOT_RETREAT'); // the landing force, not the orbital fleet
      }

      applyRetreatToll(fleet, h.ctx.data);
      fleet.battleId = null;

      // Free the opponent's side (a fleet can pursue; a garrison ref is a no-op),
      // then dissolve the now-one-sided battle.
      // Отпускаем ВСЕ остальные стороны: на двух это прежний «противник», на N — каждый,
      // кто остался в распускаемом бою.
      for (const side of battle.sides) {
        if (!isThisFleet(side.ref)) releaseOrDestroyFleet(h, side.ref);
      }
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
      // MSB-1: гибель ЛЮБОЙ стороны закрывает бой — на двух это прежнее правило, а при N
      // это выбор владельца «цепочка: каждая смерть — конец боя» (§0.0 №5 роадмапа).
      if (battle.sides.some((side) => !sideAlive(h.state, side.ref))) {
        finishBattle(h, battle);
        return;
      }
      const attacker = attackerOf(battle);
      const defender = defenderOf(battle);
      if (!attacker || !defender) {
        finishBattle(h, battle); // повреждённое состояние — fail-secure
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

      // РАУНД НА N СТОРОН (MSB-2, решение владельца §0.0 №1: «урон дробится на всех
      // врагов»). Одновременный, из ПРЕДРАУНДОВОГО снимка: сперва считаются ВСЕ залпы, и
      // только потом наносятся. Иначе сторона, обсчитанная первой, била бы по уже
      // подбитым, и исход зависел бы от порядка обхода списка — то есть от порядка
      // вступления в бой, который к силе залпа отношения не имеет.
      //
      // Роль принадлежит СТОРОНЕ, а не паре (MSB-1): атакующий бьёт `attack`,
      // обороняющийся отвечает `defense`. При N участниках атакующими могут быть сразу
      // несколько, и «атакующий ↔ обороняющийся» перестаёт описывать бой целиком.
      const live = battle.sides.filter((side) => sideAlive(h.state, side.ref));
      const incoming = new Map<BattleSide, number>();
      for (const side of live) {
        // Враги — только ВРАЖДЕБНЫЕ живые стороны. Спрятаться за спину союзника нельзя
        // (ради этого выбор и сделан), но и бить союзника залп не имеет права.
        const enemies = live.filter(
          (other) =>
            other !== side &&
            side.owner !== null &&
            other.owner !== null &&
            isHostile(h, side.owner, other.owner),
        );
        const volley = sideDamage(h.state, side.ref, data, side.role === 'attacker' ? 'attack' : 'defense');
        for (const [i, share] of splitVolley(volley, enemies).entries()) {
          const target = enemies[i]!;
          // Хук зовётся НА ПАРУ (кто бьёт → кого бьёт), а не на весь залп: его
          // подписчики — местность, укрепления, пассивы фракции и ауры героя — меряют
          // именно отношение двух конкретных владельцев. Один вызов на всех врагов
          // сделал бы их вклад неразличимым.
          const dealt = h.hook<number>('combat.damage', share.damage, {
            battleId,
            phase: battle.phase,
            location: battle.location,
            attacker: side.owner,
            defender: target.owner,
          });
          incoming.set(target, (incoming.get(target) ?? 0) + dealt);
        }
      }
      for (const [side, dmg] of incoming) {
        if (dmg > 0) applyDamageToSide(h, side.ref, dmg, data, battle.location);
      }

      // Полезная нагрузка события — единственная двойственность боя, которая уезжает ПО
      // ШИНЕ наружу, и у неё есть чужой потребитель: `construction.ts` берёт
      // `dmgToDefender` и стачивает им постройки штурмуемого мира. Поэтому число это —
      // СУММА всего, что легло на обороняющегося, а не вклад одного нападающего из пяти:
      // иначе форт крошился бы по одной пятой урона, и разошлось бы это МОЛЧА.
      // Пары `attacker`/`defender` тут хватает ровно потому, что обороняющийся в бою
      // один; полный расклад по сторонам едет рядом, в `sides` (его читает MSB-6).
      h.emit('combat.round', {
        battleId,
        round: battle.round,
        phase: battle.phase,
        location: battle.location,
        attacker: attacker.owner,
        defender: defender.owner,
        dmgToAttacker: incoming.get(attacker) ?? 0,
        dmgToDefender: incoming.get(defender) ?? 0,
        sides: battle.sides.map((side) => ({
          owner: side.owner,
          role: side.role,
          damage: incoming.get(side) ?? 0,
        })),
      });

      // Гибель ЛЮБОЙ стороны закрывает бой (§0.0 №5, «цепочка»): выжившие сцепятся
      // заново. На двух сторонах это прежнее правило дословно.
      if (battle.sides.every((side) => sideAlive(h.state, side.ref))) {
        scheduleTick(h, battleId);
      } else {
        finishBattle(h, battle);
      }
    });
  },
};

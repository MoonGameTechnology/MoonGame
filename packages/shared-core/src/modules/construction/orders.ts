/** Стройка: приказы игрока. Вынесено из `../construction.ts` (SLIM). */
import type { ModuleSetupApi } from '../../kernel/module';
import type { BuildUnitPayload, CompletePayload } from '../../state/construction';
import {
  type BuildingDamage,
  type CancelConstructionPayload,
  type ConstructBuildingPayload,
  type ConstructionDelay,
  type ResumeConstructionPayload,
  atInstanceCap,
  damageBuildings,
  damageChosenBuildings,
  delayFirstOrder,
  enqueueOrder,
  isQueued,
  laneBusy,
  orderSpec,
  ownedPlanet,
  parkActive,
  requireUnlocked,
  slotsAt,
  startNextAfter,
  suppressed,
} from './kit';
import { FORTRESS_CORE, buildingRepairQuote } from '../../state/fortress';
import {
  GROUND_FACILITY,
  hasGroundFacility,
  hasShipyard,
  unitYardLevelBlocker,
} from '../../state/buildFacilities';
import type { StructureDamage } from '../../util/structureDamage';
import { allowedBuildings, isBuildable } from '../../state/sectorKind';
import { buildingLevel, buildingMaxLevel } from '../../data/schemas';
import { canAfford, payCost } from '../../util/treasury';
import { hoursToMs } from '../../action/types';
import { matchBuildingHours, matchCost } from '../../util/pricing';
import { mobilizationHead } from '../../state/mobilization';
import { orderLane } from '../../state/buildLane';
import { scheduleCompletion } from './schedule';
import { shuttleBayAt } from '../../state/shuttle';
import { validateLoadout, withBonusSlots } from '../../util/loadout';
import { worksFor } from '../../util/infestation';

/** Возможности урона и задержки, ремонт, постройка и улучшение зданий. */
export function registerBuildingOrders(api: ModuleSetupApi): void {
  api.provideCapability<StructureDamage>('construction.impact', (h, id, amount, owner, covered) => {
    const planet = h.state.planets[id];
    if (planet && amount > 0) damageBuildings(h, planet, amount, owner, covered);
  });
  api.provideCapability<BuildingDamage>('building.damage', damageChosenBuildings);
  api.provideCapability<ConstructionDelay>('construction.delay', delayFirstOrder);
  api.onAction('building.repair', (action, h) => {
    const payload = action.payload as { planetId?: string; building?: string; uid?: string };
    if (typeof payload.planetId !== 'string' || typeof payload.building !== 'string') return h.reject('E_BAD_PAYLOAD');
    const { planet, player } = ownedPlanet(h, action, payload.planetId);
    const stopped = suppressed(h, planet.id);
    if (stopped) return h.reject(stopped);
    if (planet.fortress && payload.building === FORTRESS_CORE) return h.reject('E_USE_STATION_REPAIR');
    const instance = payload.uid ? planet.buildings.find((b) => b.uid === payload.uid && b.type === payload.building)
      : planet.buildings.find((b) => b.type === payload.building);
    if (!instance || instance.hp <= 0) return h.reject('E_NO_BUILDING');
    if (instance.repair) return h.reject('E_REPAIR_IN_PROGRESS');
    const quote = buildingRepairQuote(instance, h.ctx.data);
    if (!(quote.missingHp > 0)) return h.reject('E_NOTHING_TO_REPAIR');
    const cost = matchCost(h.state, quote.cost);
    if (!canAfford(player.resources, cost)) return h.reject('E_INSUFFICIENT');
    payCost(player.resources, cost);
    const hours = matchBuildingHours(h.state, quote.hours);
    const doneAt = h.ctx.now + hoursToMs(h.ctx, hours);
    instance.repair = { owner: action.playerId, remainingHp: quote.missingHp,
      hpPerHour: quote.missingHp / hours, doneAt };
    h.schedule(doneAt, 'building.repair.complete', { planetId: planet.id, building: instance.type, uid: instance.uid });
    h.emit('building.repair.started', { planetId: planet.id, building: instance.type, uid: instance.uid,
      owner: action.playerId, cost, doneAt });
  });

  api.on('building.repair.complete', (event, h) => {
    const p = event.payload as { planetId?: string; building?: string; uid?: string };
    const planet = p.planetId ? h.state.planets[p.planetId] : undefined;
    const instance = p.uid ? planet?.buildings.find((b) => b.uid === p.uid)
      : planet?.buildings.find((b) => b.type === p.building);
    const repair = instance?.repair;
    if (!planet || !instance || !repair) return;
    if (planet.owner !== repair.owner) { delete instance.repair; return; }
    if (repair.remainingHp > 1e-8) {
      h.schedule(Math.max(repair.doneAt, h.ctx.now + hoursToMs(h.ctx, repair.remainingHp / repair.hpPerHour)),
        'building.repair.complete', p);
      return;
    }
    delete instance.repair;
    h.emit('building.repaired', { planetId: planet.id, building: instance.type, uid: instance.uid, owner: planet.owner });
  });

  api.onAction('building.construct', (action, h) => {
    const payload = action.payload as Partial<ConstructBuildingPayload>;
    if (typeof payload?.planetId !== 'string' || typeof payload?.building !== 'string') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const { planet, player } = ownedPlanet(h, action, payload.planetId);
    if (planet.fortress?.assembly?.from === 0) return h.reject('E_UNDER_CONSTRUCTION');
    const stopped = suppressed(h, planet.id);
    if (stopped) {
      return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
    }
    const def = h.ctx.data.buildings[payload.building];
    if (!def) {
      return h.reject('E_UNKNOWN_BUILDING');
    }
    // Retirement affects new intent only. Existing production, accepted queue
    // entries, paid completions and paused sites retain their original contract.
    if (def.retired) {
      return h.reject('E_BUILDING_RETIRED');
    }
    // 0. Органы Роя (`infected`) растит только Рой (решение владельца 2026-09-24):
    //    у остальных они не работают, и яма биомассы у людей была источником биомассы.
    if (!worksFor(h.state, action.playerId, def, h.ctx.data)) {
      return h.reject('E_SWARM_ONLY');
    }
    // Province type decides construction in TWO steps, and both are gates here.
    //
    // 1. `buildable` — can anything at all be raised on this province type? Until
    //    SEC/BLD-… this flag was declared in `sectorKinds` and read by nobody but the
    //    map renderer, so `buildable: false` blocked nothing: `empty`/`debris_field`
    //    were safe only because they ALSO carry `allowedBuildings: []`. Same defect
    //    `orbit` had before ORB-1 turned it into a rule; this is that fix for
    //    `buildable`. Now a nebula or an ion storm needs no roster to host nothing.
    if (!isBuildable(h.ctx.data, planet)) {
      return h.reject('E_WRONG_SECTOR'); // nothing is raised on this province type
    }
    // 2. `allowedBuildings` — WHICH structures a buildable province type hosts.
    //    undefined roster (kind-less / unknown / roster-less) = any building —
    //    kind-less scenario worlds keep building exactly as before. An explicit
    //    `[]` means "no construction here" (empty / debris).
    const roster = allowedBuildings(h.ctx.data, planet);
    if (roster !== undefined && !roster.includes(payload.building)) {
      return h.reject('E_WRONG_SECTOR'); // this structure does not fit this province type
    }
    // 3. `onlyOn` — ограничение со стороны САМОГО ЗДАНИЯ (решение владельца 3): «строится
    //    ТОЛЬКО там-то». Ростером вида этого не выразить: у планеты ростера нет вовсе
    //    (undefined = любое здание), и запретить ей добывающую станцию можно было бы
    //    лишь выписав поимённый список всех ОСТАЛЬНЫХ зданий — список, устаревающий на
    //    первом же новом здании, причём молча. Ворота те же и код отказа тот же: игроку
    //    важно «сюда нельзя», а не чьё правило сработало.
    const onlyOn = h.ctx.data.buildings[payload.building]?.onlyOn;
    if (onlyOn !== undefined && !onlyOn.includes(planet.kind ?? '')) {
      return h.reject('E_WRONG_SECTOR');
    }
    // 4. `buildSlots` — СКОЛЬКО построек узел вообще вмещает (решения 10 и 11). Своё
    //    место в порядке ворот: первые три отвечают «что сюда ставят», это — «влезет
    //    ли ещё одна». Код отказа поэтому другой: «сюда нельзя» и «места кончились»
    //    игроку говорят разное, и второе лечится прокачкой. Не `E_NO_SLOTS` — тот уже
    //    занят фиттингами корабля, и его текст («слоты фиттингов заняты») в ответ на
    //    заказ постройки соврал бы.
    const slots = slotsAt(h, planet);
    if (slots && slots.used >= slots.capacity) {
      return h.reject('E_NO_BUILD_SLOTS');
    }
    requireUnlocked(h, action.playerId, 'building', payload.building, planet.id);
    if (atInstanceCap(h, planet, payload.building)) {
      return h.reject('E_ALREADY_BUILT'); // лимит экземпляров исчерпан (maxPerPlanet)
    }
    if (isQueued(h, 'building', planet.id, payload.building)) {
      return h.reject('E_ALREADY_QUEUED');
    }
    if (
      planet.pausedConstruction?.some(
        (s) => s.kind === 'building' && s.building === payload.building,
      )
    ) {
      return h.reject('E_ALREADY_PAUSED'); // resume it instead of re-ordering fresh
    }
    // BLD-1: полоса занята — заказ встаёт в очередь и стартует сам. Денег у него
    // здесь не спрашивают: он сейчас и не стартует (правило 3).
    if (laneBusy(h, planet.id, 'buildings')) {
      const code = enqueueOrder(h, planet, {
        kind: 'building',
        playerId: action.playerId,
        building: payload.building,
      });
      return code ? h.reject(code) : undefined;
    }
    const level1 = buildingLevel(def, 1);
    const cost = matchCost(h.state, level1.cost);
    if (!canAfford(player.resources, cost)) {
      return h.reject('E_INSUFFICIENT');
    }
    payCost(player.resources, cost);
    scheduleCompletion(h, matchBuildingHours(h.state, level1.buildTimeHours), {
      kind: 'building',
      planetId: planet.id,
      playerId: action.playerId,
      building: payload.building,
    });
    h.emit('construction.started', {
      kind: 'building',
      planetId: planet.id,
      building: payload.building,
      playerId: action.playerId,
    });
  });

  api.onAction('building.upgrade', (action, h) => {
    const payload = action.payload as Partial<ConstructBuildingPayload & { uid?: string }>;
    if (typeof payload?.planetId !== 'string' || typeof payload?.building !== 'string') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const { planet, player } = ownedPlanet(h, action, payload.planetId);
    if (planet.fortress?.assembly?.from === 0) return h.reject('E_UNDER_CONSTRUCTION');
    const stopped = suppressed(h, planet.id);
    if (stopped) {
      return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
    }
    // RULES-2.1: address a SPECIFIC instance by uid when maxPerPlanet > 1.
    // Without uid (old client / maxPerPlanet=1), fall back to find-by-type.
    const instance = payload.uid
      ? planet.buildings.find((b) => b.uid === payload.uid)
      : planet.buildings.find((b) => b.type === payload.building);
    if (!instance) {
      return h.reject('E_NO_BUILDING'); // nothing of that type to upgrade
    }
    const def = h.ctx.data.buildings[instance.type];
    if (!def) {
      return h.reject('E_UNKNOWN_BUILDING');
    }
    // Захваченный орган Роя не растят — его зачищают (решение владельца 2026-09-24).
    if (!worksFor(h.state, action.playerId, def, h.ctx.data)) {
      return h.reject('E_SWARM_ONLY');
    }
    const nextLevel = instance.level + 1;
    if (nextLevel > buildingMaxLevel(def)) {
      return h.reject('E_MAX_LEVEL');
    }
    if (isQueued(h, 'upgrade', planet.id, instance.type)) {
      return h.reject('E_ALREADY_QUEUED');
    }
    if (
      planet.pausedConstruction?.some((s) => s.kind === 'upgrade' && s.building === instance.type)
    ) {
      return h.reject('E_ALREADY_PAUSED'); // resume it instead of re-ordering fresh
    }
    if (laneBusy(h, planet.id, 'buildings')) {
      const code = enqueueOrder(h, planet, {
        kind: 'upgrade',
        playerId: action.playerId,
        building: instance.type,
        level: nextLevel,
        uid: instance.uid,
      });
      return code ? h.reject(code) : undefined;
    }
    const next = buildingLevel(def, nextLevel);
    const cost = matchCost(h.state, next.cost);
    if (!canAfford(player.resources, cost)) {
      return h.reject('E_INSUFFICIENT');
    }
    payCost(player.resources, cost);
    scheduleCompletion(h, matchBuildingHours(h.state, next.buildTimeHours), {
      kind: 'upgrade',
      planetId: planet.id,
      playerId: action.playerId,
      building: instance.type,
      level: nextLevel,
      uid: instance.uid,
    });
    h.emit('construction.started', {
      kind: 'upgrade',
      planetId: planet.id,
      building: instance.type,
      level: nextLevel,
      playerId: action.playerId,
    });
  });
}

/** Заказ юнитов, отмена и возобновление стройки. */
export function registerUnitOrders(api: ModuleSetupApi): void {
  api.onAction('unit.build', (action, h) => {
    const payload = action.payload as Partial<BuildUnitPayload>;
    if (typeof payload?.planetId !== 'string' || typeof payload?.unit !== 'string') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const count = payload.count ?? 1;
    if (!Number.isSafeInteger(count) || count <= 0) {
      return h.reject('E_BAD_PAYLOAD');
    }
    const { planet, player } = ownedPlanet(h, action, payload.planetId);
    const stopped = suppressed(h, planet.id);
    if (stopped) {
      return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
    }
    const def = h.ctx.data.units[payload.unit];
    if (!def) {
      return h.reject('E_UNKNOWN_UNIT');
    }
    // ВЫДАВАЕМОЕ НЕ ЗАКАЗЫВАЮТ: трейт `issued` значит «этот отряд приходит вместе с
    // сооружением, которому принадлежит» — орудия крепости (FORT-5.4), гарнизон форта
    // (FORT-2.2). Без этих ворот орудия крепости заказывались бы на любой верфи как
    // обычный корабль: домен у них космический, а верфь в ростере крепости есть.
    //
    // Мерять по `immobile` было БЫ ОШИБКОЙ, и её поймал сторож `autoRally`: неподвижность
    // и «не заказывается» — разные вещи. Стационарная зенитка в гарнизоне тоже неподвижна,
    // но её игрок как раз строит, и близкий зенитный залп на этом и держится.
    if (def.traits.includes('issued')) {
      return h.reject('E_NOT_BUILDABLE');
    }
    requireUnlocked(h, action.playerId, 'unit', payload.unit, planet.id);
    // Челнок строится В КОСМОПОРТЕ и остаётся в нём. Порт — только ворота (SHU-1.1):
    // ноль вместимости читается как «порта нет», а предела нет вовсе — космопорт
    // держит сколько угодно машин (SHU-5.1, резолюция владельца 2026-09-26).
    const isShuttle = def.traits.includes('shuttle');
    if (isShuttle && shuttleBayAt(planet, h.ctx.data) <= 0) {
      return h.reject('E_NO_PORT');
    }
    if (!isShuttle && def.domain === 'space' && !hasShipyard(planet, h.ctx.data)) {
      return h.reject('E_NO_SHIPYARD');
    }
    // Класс корпуса против размера стапеля (решение владельца 15). Отдельный код от
    // `E_NO_SHIPYARD`: «верфи нет» и «верфь мала» игроку говорят разное — первое лечится
    // постройкой, второе прокачкой, и подменять их значило бы отправить его строить
    // вторую верфь там, где нужна та же, но выше.
    const yardBlock = unitYardLevelBlocker(planet, def, h.ctx.data);
    if (yardBlock) return h.reject(yardBlock);
    // Наземный юнит идёт в СВОЁ здание: пехота в казармы, техника на завод
    // (ROS-1.1). Отказ называет недостающее здание, а не «наземное производство» —
    // игроку из кода отказа должно быть видно, что именно строить.
    if (def.domain === 'ground' && !hasGroundFacility(planet, h.ctx.data, def.kind)) {
      return h.reject(GROUND_FACILITY[def.kind].code);
    }
    // ДЕСАНТНЫЙ ЧЕЛНОК строится сразу с бойцом внутри (SHU-5.2, резолюция владельца
    // 2026-09-26): игрок выбирает наземный юнит, платит за челнок и за него, и условия
    // постройки бойца — открытие технологией и его здание на ЭТОМ мире — те же, что у
    // заказа самого бойца. Иначе челнок стал бы обходным путём к танку без завода.
    const lander = def.traits.includes('lander');
    const troopId = payload.troop;
    if (
      lander !== (troopId !== undefined) ||
      (troopId !== undefined && typeof troopId !== 'string')
    ) {
      return h.reject('E_BAD_PAYLOAD');
    }
    const troopDef = troopId !== undefined ? h.ctx.data.units[troopId] : undefined;
    if (troopId !== undefined) {
      if (!troopDef) return h.reject('E_UNKNOWN_UNIT');
      if (troopDef.domain !== 'ground') return h.reject('E_NOT_GROUND');
      if (troopDef.traits.includes('issued') || troopDef.traits.includes('immobile')) {
        return h.reject('E_NOT_BUILDABLE');
      }
      requireUnlocked(h, action.playerId, 'unit', troopId, planet.id);
      if (!hasGroundFacility(planet, h.ctx.data, troopDef.kind)) {
        return h.reject(GROUND_FACILITY[troopDef.kind].code);
      }
    }
    // ARS-3 ownership gate: a seat with an arsenal SNAPSHOT builds only what it
    // owns — the hull and every module must be listed (fail-secure E_NOT_OWNED).
    // No snapshot on the player ⇒ no restriction (regular/dev matches unchanged).
    //
    // ГЕЙТ СПРАШИВАЕТ ТОЛЬКО ПРО КОРАБЛИ (решение владельца 2026-09-15). Пока он не
    // различал домен, гейтированное место (человеческое кресло AvA) не могло построить
    // НИ ОДНОГО наземного юнита: снапшот перечисляет корпуса кораблей, а пехоты и
    // техники в нём не бывает никогда. Кресло получало стартовый гарнизон и теряло
    // способность его пополнять — захват миров закрывался целиком, хотя казармы с
    // заводом стояли. Замысел арсенала (`docs/arsenal-roadmap.md`) — «корпуса КОРАБЛЕЙ,
    // модули, фитинги героев», и наземка в него не входила ни дня; поэтому сузилось
    // ПРАВИЛО, а не расширился список. Наземный род войск гейтят ЗДАНИЯ (выше).
    const arsenal = def.domain === 'ground' ? undefined : player.arsenal;
    if (arsenal && !arsenal.hulls.includes(payload.unit)) {
      return h.reject('E_NOT_OWNED');
    }
    const modules = payload.modules;
    if (modules !== undefined) {
      if (!Array.isArray(modules) || !modules.every((m) => typeof m === 'string')) {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (arsenal && modules.some((m) => !arsenal.modules.includes(m))) {
        return h.reject('E_NOT_OWNED');
      }
      // Звёзды корабля этого места открывают лишние слоты (Sector Zero).
      const hull = withBonusSlots(def, arsenal?.slots?.[payload.unit]);
      const valid = validateLoadout(payload.unit, hull, modules, h.ctx.data);
      if (!valid.ok) return h.reject(valid.code);
    }
    if (laneBusy(h, planet.id, orderLane(h.ctx.data, { kind: 'unit', unit: payload.unit })) || (orderLane(h.ctx.data, { kind: 'unit', unit: payload.unit }) === 'mobilization' && mobilizationHead(h.state, planet.id, h.ctx.data))) {
      const code = enqueueOrder(h, planet, {
        kind: 'unit',
        playerId: action.playerId,
        unit: payload.unit,
        count,
        ...(modules && modules.length > 0 ? { modules } : {}),
        ...(troopId !== undefined ? { troop: troopId } : {}),
      });
      return code ? h.reject(code) : undefined;
    }
    // The loadout is paid up-front with the hull and locked onto the built stack.
    // Десантный челнок — вместе со своим бойцом (SHU-5.2); цена и срок — `orderSpec`,
    // та же функция, что считает возврат при отмене.
    const spec = orderSpec(h.state, h.ctx.data, {
      kind: 'unit',
      unit: payload.unit,
      count,
      ...(modules && modules.length > 0 ? { modules } : {}),
      ...(troopId !== undefined ? { troop: troopId } : {}),
    });
    if (!spec) return h.reject('E_UNKNOWN_UNIT');
    const cost = spec.cost;
    if (!canAfford(player.resources, cost)) {
      return h.reject('E_INSUFFICIENT');
    }
    payCost(player.resources, cost);
    scheduleCompletion(h, spec.hours, {
      kind: 'unit',
      planetId: planet.id,
      playerId: action.playerId,
      unit: payload.unit,
      count,
      ...(modules && modules.length > 0 ? { modules } : {}),
      ...(troopId !== undefined ? { troop: troopId } : {}),
    });
    h.emit('construction.started', {
      kind: 'unit',
      planetId: planet.id,
      unit: payload.unit,
      count,
      playerId: action.playerId,
    });
  });

  // Cancel an ACTIVE (already paid, already ticking) build/upgrade/unit order:
  // refunds the unbuilt share of its cost and parks it as a resumable paused site
  // — the investment isn't lost, just halted (GDD: partial-refund cancel). The
  // building never existed in `planet.buildings` to begin with (it only lands
  // there on `construction.complete`), so there's nothing else to roll back.
  api.onAction('construction.cancel', (action, h) => {
    const payload = action.payload as Partial<CancelConstructionPayload>;
    if (typeof payload?.planetId !== 'string' || typeof payload?.seq !== 'number') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const { planet } = ownedPlanet(h, action, payload.planetId);
    // BLD-1. Один номер — один заказ, независимо от того, СТРОИТСЯ он или ЖДЁТ:
    // `id` ждущего берётся из того же счётчика, что и `seq` запланированного, так
    // что перепутать их нельзя. Игроку это одна кнопка «отменить», а не две.
    const waiting = (planet.buildQueue ?? []).find((q) => q.id === payload.seq);
    if (waiting) {
      if (waiting.playerId !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      planet.buildQueue = (planet.buildQueue ?? []).filter((q) => q.id !== payload.seq);
      if (planet.buildQueue.length === 0) delete planet.buildQueue;
      // Возврата нет и быть не может: ждущий заказ не оплачен (правило 2). Поэтому
      // же он не становится `PausedConstructionSite` — возобновлять нечего.
      h.emit('construction.cancelled', {
        planetId: planet.id,
        seq: payload.seq,
        kind: waiting.kind,
        progress: 0,
        playerId: action.playerId,
        waiting: true,
      });
      startNextAfter(h, planet, orderLane(h.ctx.data, waiting));
      return;
    }
    const event = h.state.scheduled.find(
      (e) => e.type === 'construction.complete' && e.seq === payload.seq,
    );
    if (!event) {
      return h.reject('E_NOT_ACTIVE'); // already completed, or never existed
    }
    const p = event.payload as CompletePayload;
    if (p.planetId !== planet.id || p.playerId !== action.playerId) {
      return h.reject('E_FORBIDDEN'); // that seq belongs to someone else's order
    }
    if (!parkActive(h, planet, event)) {
      return h.reject('E_UNKNOWN_BUILDING');
    }
  });

  // Resume a paused site: pays exactly what was refunded, re-schedules exactly the
  // remaining duration (not the full one) — the build continues from where it was
  // paused, it does not restart.
  api.onAction('construction.resume', (action, h) => {
    const payload = action.payload as Partial<ResumeConstructionPayload>;
    if (typeof payload?.planetId !== 'string' || typeof payload?.id !== 'number') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const { planet, player } = ownedPlanet(h, action, payload.planetId);
    const stopped = suppressed(h, planet.id);
    if (stopped) {
      return h.reject(stopped); // узел не работает: обстрел либо бой прямо здесь
    }
    const paused = planet.pausedConstruction ?? [];
    const site = paused.find((s) => s.id === payload.id);
    if (!site) {
      return h.reject('E_NOT_PAUSED');
    }
    if (site.kind === 'building' && typeof site.building === 'string') {
      if (atInstanceCap(h, planet, site.building)) {
        return h.reject('E_ALREADY_BUILT');
      }
      if (isQueued(h, 'building', planet.id, site.building)) {
        return h.reject('E_ALREADY_QUEUED');
      }
    } else if (
      site.kind === 'upgrade' &&
      typeof site.building === 'string' &&
      typeof site.level === 'number'
    ) {
      const instance = site.uid
        ? planet.buildings.find((b) => b.uid === site.uid)
        : planet.buildings.find((b) => b.type === site.building);
      if (!instance || instance.level !== site.level - 1) {
        return h.reject('E_STALE_CONSTRUCTION'); // building moved on without this upgrade
      }
      if (isQueued(h, 'upgrade', planet.id, site.building)) {
        return h.reject('E_ALREADY_QUEUED');
      }
    } else if (site.kind === 'unit' && typeof site.unit === 'string') {
      // Resuming starts the build again, so it passes the order's gate (BAL-19).
      requireUnlocked(h, action.playerId, 'unit', site.unit, planet.id);
    }
    // BLD-1: возобновление — это СТАРТ, а полоса одна. В очередь его не ставим:
    // приостановленная стройка уже хранит свой прогресс и остаток цены отдельно
    // (`PausedConstructionSite`), и заводить ей второе место ожидания значило бы
    // держать одну сущность в двух списках. Игрок возобновит, когда полоса освободится.
    if (laneBusy(h, planet.id, orderLane(h.ctx.data, site)) || (orderLane(h.ctx.data, site) === 'mobilization' && mobilizationHead(h.state, planet.id, h.ctx.data))) {
      return h.reject('E_LANE_BUSY');
    }
    if (!canAfford(player.resources, site.remainingCost)) {
      return h.reject('E_INSUFFICIENT');
    }
    payCost(player.resources, site.remainingCost);
    planet.pausedConstruction = paused.filter((s) => s.id !== payload.id);
    const fullHours = site.progress < 1 ? site.remainingHours / (1 - site.progress) : 0;
    scheduleCompletion(h, site.remainingHours, {
      kind: site.kind,
      planetId: planet.id,
      playerId: action.playerId,
      building: site.building,
      level: site.level,
      unit: site.unit,
      count: site.count,
      modules: site.modules,
      moduleSnapshot: site.moduleSnapshot,
      troop: site.troop,
    }, fullHours);
    h.emit('construction.resumed', {
      planetId: planet.id,
      id: payload.id,
      kind: site.kind,
      playerId: action.playerId,
    });
  });
}

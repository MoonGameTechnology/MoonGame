/** Челноки: события полёта и правила баз. Разрезан из `../shuttle.ts` (SLIM). */
import type { ModuleSetupApi } from '../../kernel/module';
import {
  type BaseView,
  CHASE_STEP_MINUTES,
  PATROL_TICK_SHARE,
  fleetBase,
  flightOf,
  hourMs,
  nextSquadronId,
  noteBase,
  planetBase,
  scheduleChase,
  schedulePatrolTick,
  withHangar,
} from './kit';
import type { HandlerContext } from '../../kernel/module';
import { MS_PER_HOUR } from '../../util/time';
import {
  type MissileFlew,
  distanceToSegment,
  patrolStrike,
  resolveOutLeg,
  resumeHold,
} from './aloft';
import type { Squadron } from '../../state/gameState';
import { basePosition, homePosition } from '../../state/strikePosition';
import { battleLocations } from '../../state/battle';
import { chaseRadius, chaseStep } from '../../state/chase';
import { distance } from '../../state/route';
import {
  divert,
  hitMissile,
  landingSpot,
  strikeAirPower,
  strikeSpeed,
  trimCargoToSurvivors,
  turnHome,
} from './flight';
import { dockHullRate, fleetHangarRepairRate } from '../../util/repair';
import { fleetPositionAt } from '../../state/fleetPosition';
import { forkSiteInBattle } from '../../state/forkSite';
import { hangarUsed, squadronReach, stacksSize, trimHangar } from '../../state/shuttle';
import { indexServiceSites, serviceSitesForFleet } from '../../state/fortress';
import { isAllied, isHostile } from '../../util/combat';
import { recordValues } from '../../util/records';
import { sumUnitStat } from '../../util/stacks';
import { timeScaleOf } from '../../action/types';

/** Полёт: прибытие, возобновление патруля, погоня, тик патруля, ракета в круге патруля. */
export function registerFlightEvents(api: ModuleSetupApi): void {
  /**
   * Прибытие. Нога `out` — удар и разворот, нога `back` — посадка в свой порт.
   *
   * Удар проходит через combat.damage. Потери кораблей и построек применяются
   * сразу; затем цель отвечает оставшимся оружием, и вылет поворачивает домой.
   */
  api.on('shuttle.arrived', (event, h: HandlerContext) => {
    // Сбит по дороге, сел, событие от сменённого приказа (SHU-6.13) — dead letter,
    // таймлайн не застревает.
    const strike = flightOf(h, event.payload);
    if (!strike) return;
    const strikeId = strike.id;
    const strikes = h.state.strikes ?? [];
    // Прибытие РАНЬШЕ срока — устаревшее (SHU-6.2): отозванный с пути патруль получил
    // новое расписание, а старое событие осталось в очереди. Настоящее прибытие всегда
    // приходит ровно в `arrivesAt` или позже (событие, проспанное хостом), но не раньше.
    if (h.ctx.now < strike.arrivesAt) return;

    if (strike.leg === 'out') {
      resolveOutLeg(h, strike);
      return;
    }

    // Посадка — домой после удара или патруля, на новую базу при перелёте. У корабля
    // места считаются БЕЗ этого вылета (своё место он занимает сам), но с остальными,
    // ещё летящими: их места заняты до их собственной посадки.
    const spot = landingSpot(h, strike.owner, strike.base, strike.id);
    // База пропала, пока эскадра летела (снесённый порт, сбитый корабль, захваченный
    // мир), — или перелёту не хватает места: садиться сюда некуда, эскадра ищет другую
    // базу (SHU-6.4). Вернувшийся домой удар при нехватке места садится, чем влезет
    // (`trimHangar`): место за ним держалось с взлёта, и не хватить его может, только
    // если сам корабль потерял корпуса.
    if (
      !spot ||
      (strike.target.kind === 'base' && spot.room < stacksSize(strike.units, h.ctx.data))
    ) {
      return divert(h, strike, homePosition(strike, h.state, h.ctx.now) ?? strike.to, strike.base);
    }
    h.state.strikes = strikes.filter((s) => s.id !== strikeId);
    const base = spot.base;
    // Эскадра встаёт в ангар ПОД СВОИМ ИМЕНЕМ (SHU-4.2): она уходила соединением и
    // возвращается им же. Если её id за время полёта занят (перегрузка, слияние —
    // ангар живёт своей жизнью, пока машины летят), соединение садится под свежим,
    // потому что двух эскадр с одним именем в модели быть не может.
    const taken = base.hangar.some((q) => q.id === strike.squadronId);
    // Боец перелетевшего десантного челнока сходит в ангар вместе с бортом (SHU-6.4) —
    // по одному на уцелевший борт, как и при высадке.
    trimCargoToSurvivors(strike);
    const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
    // Удерживаемый патруль (SHU-6.6) садится с удержанием. Его точка у МИРА — `to`
    // обратной ноги: удержание живёт только у патруля, повернувшего домой по концу
    // времени (отзыв его снимает, а потерявший базу перестаёт быть патрулём), и
    // повернул он ровно из своей точки.
    const held = strike.target.kind === 'point' && strike.patrol?.hold === true;
    const home: Squadron = {
      id: taken ? nextSquadronId(h, strike.owner) : strike.squadronId,
      units: strike.units.map((st) => ({ ...st })),
      ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
      // Недобитый урон вылета остаётся на машинах (SHU-5.3), а не забывается на посадке.
      ...(strike.damage && strike.damage > 0 ? { damage: strike.damage } : {}),
      ...(held ? { hold: base.ref.kind === 'planet' ? { at: { ...strike.to } } : {} } : {}),
    };
    base.setHangar(trimHangar([...base.hangar, home], spot.bay, h.ctx.data));
    h.emit('shuttle.landed', {
      baseId: base.ref.id,
      baseKind: base.ref.kind,
      owner: strike.owner,
      strikeId,
    });
    if (held) h.schedule(h.ctx.now, 'shuttle.patrol.resume', { owner: strike.owner, squadronId: home.id });
  });

  /**
   * СНОВА В ПАТРУЛЬ (SHU-6.6): удерживаемый патруль сел — или его база дождалась конца
   * перезарядки, боя корабля, ремонта порта (`resumeHold`). Своё событие, а не опрос на
   * `time.advanced`: срок назначает расписание, и нарезка хоста его не сдвигает.
   */
  api.on('shuttle.patrol.resume', (event, h: HandlerContext) => {
    const p = (event.payload ?? {}) as { owner?: unknown; squadronId?: unknown };
    if (typeof p.owner !== 'string' || typeof p.squadronId !== 'string') return;
    resumeHold(h, p.owner, p.squadronId);
  });

  /**
   * ПОГОНЯ (SHU-4.4) — как летящий удар догоняет ДВИЖУЩУЮСЯ цель.
   *
   * До этого кирпича цель фиксировалась координатой на вылете, и флот, идущий по
   * линии, не брался вовсе: приказ отбивался `E_NO_TARGET_POSITION`. Причина была не в
   * правиле, а в ДУБЛЕ — у модуля лежала своя копия «где сейчас флот», и она, в отличие
   * от ядровой `fleetPositionAt`, не знала про `Fleet.movement`. Копия снята, а поверх
   * живой точки встала модель владельца: эскадра регулярно пересчитывает координаты
   * цели, правит курс к центру её радиуса и бьёт, когда на очередном пересчёте
   * оказалась ВНУТРИ радиуса.
   *
   * Пять решений, которые здесь легко потерять при правке:
   *
   * 1. **Погоня живёт на СВОЁМ событии, а не на `time.advanced`.** Отрезок непрерывного
   *    времени нарезает ХОСТ — по своим пробуждениям, чужим таймерам, гибернации, — и
   *    сетка пересчётов, привязанная к его границам, у двух хостов вышла бы разной.
   *    Одна и та же партия дала бы разный исход, а реплей разъехался бы с матчем
   *    (инвариант #1). Собственное расписание от этого не зависит вовсе.
   * 2. **Отрезок между пробуждениями ИНТЕГРИРУЕТСЯ.** Между пересчётами час, и
   *    «посмотреть только в конец» дало бы уход от любого удара: цель успела бы сделать
   *    круг и вернуться. Шаг фиксирован (`CHASE_STEP_MINUTES`) и отсчитывается от
   *    прошлого пересчёта, а не от начала отрезка хоста.
   * 3. **Поводок меряется от БАЗЫ, а не от эскадры.** `strikeRange` и на вылете
   *    считается от узла базирования (§0.2 роадмапа), второй точки отсчёта у него быть
   *    не должно. Ушёл центр радиуса за дальность — атака отменяется сама. Это и есть
   *    контригра: от медленной эскадры быстрый флот отрывается, от быстрой — никто.
   * 4. **Цель исчезла или перестала быть чужой — домой.** Добитый в бою флот и союзник,
   *    с которым помирились, одинаково не цель; гнаться за пустым id значило бы держать
   *    вылет в состоянии до конца матча.
   * 5. **Удар наносит НЕ этот обработчик.** Догнала — зовётся общая резолюция
   *    `resolveOutLeg`, та же, что у удара по миру. Урон, ответка, высадка и разворот
   *    живут в одном экземпляре; вторая копия разъехалась бы с первой ровно так же, как
   *    разъехалась копия позиции флота.
   */
  api.on('shuttle.chase', (event, h: HandlerContext) => {
    const strike = flightOf(h, event.payload);
    // Сбит по дороге, уже развернулся, сел, гонится уже по другому приказу (SHU-6.13) —
    // пересчитывать нечего (dead letter).
    if (!strike?.at || strike.leg !== 'out' || strike.target.kind !== 'fleet') return;

    const data = h.ctx.data;
    const hour = hourMs(h);
    const stepMs = Math.max(1, (CHASE_STEP_MINUTES / 60) * hour);
    const speed = strikeSpeed(strike, h.ctx);
    const radius = chaseRadius(strike.units, data);
    const leash = squadronReach(strike, data);

    let cursor = strike.departedAt; // прошлый пересчёт (правило 2)
    let caught = false;
    let lost = false;
    while (cursor < h.ctx.now && !caught && !lost) {
      const next = Math.min(cursor + stepMs, h.ctx.now);
      const target = h.state.fleets[strike.target.id];
      const aim = target ? fleetPositionAt(h.state, target, next) : null;
      const home = basePosition(strike.base, h.state, next);
      if (!target || target.owner === strike.owner || !aim || !home) {
        lost = true; // правило 4
        break;
      }
      if (distance(home, aim) > leash) {
        lost = true; // правило 3
        break;
      }
      const step = chaseStep(strike.at, aim, speed * ((next - cursor) / hour), radius);
      strike.at = step.at;
      strike.to = aim;
      caught = step.caught;
      cursor = next;
    }

    noteBase(h, strike); // корабль-база жив — запомнить, где он (SHU-6.4)
    if (caught) return resolveOutLeg(h, strike); // правило 5
    if (lost) return turnHome(h, strike);
    // Ни догнала, ни сорвалась: закрыть отрезок и переназначить пересчёт. `departedAt`
    // у погони — момент ПОСЛЕДНЕГО пересчёта, а `arrivesAt` — оценка на нынешнем
    // прицеле: расписания у неё нет, но игроку надо видеть, догоняет она или отстаёт.
    const left = Math.max(0, distance(strike.at, strike.to) - radius);
    strike.departedAt = h.ctx.now;
    strike.arrivesAt = h.ctx.now + (speed > 0 ? Math.round((left / speed) * hour) : 0);
    scheduleChase(h, strike);
  });

  /**
   * ТИК ПАТРУЛЯ (SHU-6.2): удар по одной цели в круге (`patrolStrike`), затем — либо
   * следующий тик, либо домой, если время патруля вышло. Конец патруля — тоже тик: в
   * последнюю минуту круг держится так же, как в первую.
   */
  api.on('shuttle.patrol.tick', (event, h: HandlerContext) => {
    const strike = flightOf(h, event.payload);
    // Отозван, сбит, уже летит домой, перенесён в новую точку (SHU-6.13) — тик ничей
    // (dead letter).
    if (!strike || strike.leg !== 'patrol') return;
    noteBase(h, strike); // корабль-база жив — запомнить, где он (SHU-6.4)
    patrolStrike(h, strike);
    // Ответка цели могла сбить патруль целиком — домой лететь некому.
    if (strike.units.length === 0) {
      h.state.strikes = (h.state.strikes ?? []).filter((st) => st.id !== strike.id);
      return;
    }
    if (h.ctx.now >= strike.arrivesAt) return turnHome(h, strike);
    schedulePatrolTick(h, strike);
  });

  /**
   * ВЫСТРЕЛ ПРИ ВЛЁТЕ (SM-3.7d, решение владельца 2026-10-14). Ракета пролетает круг
   * патруля за минуты, а тик патруля — раз в 15 минут: без этого выстрела она проскакивала
   * бы между тиками. Висящий патруль бьёт её долей тика, когда пройденный ею отрезок входит
   * в его круг, — по отрезку, а не по точке, поэтому круг не перепрыгнуть и за один шаг.
   * Ракета, пущенная уже внутри круга, не «влетает»: её бьёт обычный тик.
   *
   * Возможность, а не событие: `rocketMines` зовёт её синхронно на каждом шаге полёта и
   * ПЕРЕД попаданием, с последним отрезком до цели. Событие разбиралось бы после того, как
   * попадание уже сняло ракету с карты, и влёт в последнюю минуту (или весь полёт короче
   * минуты) остался бы без выстрела (замечание Codex на #1644).
   */
  api.provideCapability<MissileFlew>('missile.flew', (h, missileId, from, to) => {
    for (const strike of h.state.strikes ?? []) {
      const missile = Object.prototype.hasOwnProperty.call(h.state.fleets, missileId)
        ? h.state.fleets[missileId]
        : undefined;
      if (!missile) return;
      if (strike.leg !== 'patrol' || strike.units.length === 0) continue;
      if (strike.owner === missile.owner || !isHostile(h, strike.owner, missile.owner)) continue;
      const radius = strike.patrol?.radius ?? 0;
      if (radius <= 0 || distance(from, strike.to) <= radius) continue;
      if (distanceToSegment(from, to, strike.to) > radius) continue;
      hitMissile(h, strike, missile, strikeAirPower(strike, h.ctx.data) * PATROL_TICK_SHARE);
    }
  });
}

/** Базы: ангары без базы, ремонт в ангаре, захват мира, гибель станции. */
export function registerBaseUpkeep(api: ModuleSetupApi): void {
  /**
   * АНГАР НЕ ПЕРЕЖИВАЕТ СВОЮ БАЗУ (SHU-1.1, распространено на носители в SHU-2.1).
   * Челнок стоит ВНУТРИ космопорта или носителя, поэтому снесённый порт и сбитые
   * корпуса носителя забирают его с собой, а упавшая вместимость оставляет ровно
   * столько, сколько теперь помещается.
   *
   * Правило висит на `time.advanced`, а не на событии «здание разрушено», намеренно:
   * база исчезает НЕСКОЛЬКИМИ путями — бомбардировка, наземный штурм, гибель корпусов
   * в бою, — а вместимость может упасть и от смены уровня. Реакция на одно событие
   * закрыла бы один путь и оставила остальные, и в состоянии остались бы челноки,
   * которым негде стоять. Здесь же ловится захват: мир сменил владельца — ангар
   * прежнего хозяина пуст (`planet.captured` ниже снимает его сразу, это лишь
   * страховка того же правила).
   *
   * Флот, погибший ЦЕЛИКОМ, отдельного правила не требует: ангар лежит НА флоте, и
   * удаление флота уносит его с собой — осиротеть здесь нечему. Вылет, чья база
   * исчезла за время полёта, ловится на повороте к ней или на посадке и ищет, где сесть
   * (`divert`, SHU-6.4): решение в точке расписания, а не здесь, на нарезке хоста.
   */
  api.on('time.advanced', (_event, h: HandlerContext) => {
    // Вид базы собирается только там, где есть ангар (`withHangar`): пустой ангар
    // пропускался и раньше, а вид на каждый мир и флот стоил на каждом отрезке времени.
    const bases: BaseView[] = [
      ...recordValues(h.state.planets)
        .filter(withHangar)
        .map((planet) => ({
          ...planetBase(planet, h.ctx.data),
          // Ничей мир не держит ангар: вместимость нейтрального мира читается как 0.
          bay: planet.owner === null ? 0 : planetBase(planet, h.ctx.data).bay,
        })),
      ...recordValues(h.state.fleets)
        .filter(withHangar)
        .map((fleet) => fleetBase(fleet, h.state, h.ctx.data, h.ctx.now)),
    ];
    for (const base of bases) {
      if (base.hangar.length === 0) continue;
      const kept = trimHangar(base.hangar, base.bay, h.ctx.data);
      const lost = hangarUsed({ hangar: base.hangar }) - hangarUsed({ hangar: kept });
      if (lost <= 0) continue;
      base.setHangar(kept);
      h.emit('shuttle.lost', {
        baseId: base.ref.id,
        baseKind: base.ref.kind,
        owner: base.owner,
        count: lost,
      });
    }
  });

  /**
   * РЕМОНТ ЭСКАДР (SHU-5.3). Урон, привезённый с вылета, чинится у ДОКА тем же темпом,
   * что корпус корабля (`shipRepair` живых построек, доля полного корпуса в час): в
   * порту своего мира и на борту флота, стоящего у своего или союзного дока
   * (`fleetAtOwnDock` — правило одно на все пути ремонта). Флот с ремонтным ангаром
   * (`repair_bay`, SHU-5.4) чинит свои эскадры и в походе. Пока на узле бой, ремонта
   * нет — как и у кораблей (решение владельца 17).
   */
  api.on('time.advanced', (event, h: HandlerContext) => {
    const { from, to } = event.payload as { from: number; to: number };
    if (to <= from) return;
    const hours = ((to - from) / MS_PER_HOUR) * timeScaleOf(h.ctx);
    const data = h.ctx.data;
    const fighting = battleLocations(h.state);
    const mend = (hangar: readonly Squadron[], rate: number): void => {
      if (rate <= 0) return;
      for (const sq of hangar) {
        if (!sq.damage) continue;
        const left = sq.damage - rate * hours * sumUnitStat(sq.units, data, 'hp');
        if (left > 0) sq.damage = left;
        else delete sq.damage;
      }
    };
    const blockedPorts = new Set<string>();
    for (const planet of recordValues(h.state.planets)) {
      if (planet.owner === null) continue;
      if (fighting.has(planet.id) || forkSiteInBattle(h.state, planet)) { blockedPorts.add(planet.id); continue; }
      if (!planet.hangar?.length) continue;
      mend(planet.hangar, dockHullRate(planet, data));
    }
    // Флот чинит свой ангар ремонтным модулем ВЕЗДЕ вне боя (SHU-5.4), у дока — сверх
    // темпа дока.
    const serviceIndex = indexServiceSites(h.state);
    for (const fleet of recordValues(h.state.fleets)) {
      if (!fleet.hangar?.length || fleet.battleId) continue;
      if (fleet.location !== null && fighting.has(fleet.location)) continue;
      const ports = serviceSitesForFleet(h.state, fleet, (a, b) => isAllied(h, a, b), serviceIndex);
      if (ports.some((port) => blockedPorts.has(port.id))) continue;
      const dock = ports.reduce((rate, port) => rate + dockHullRate(port, data), 0);
      mend(fleet.hangar, dock + fleetHangarRepairRate(fleet, data));
    }
  });

  /** Мир захвачен — челноки прежнего владельца гибнут вместе с портом, а не достаются
   *  захватчику (резолюция владельца 2026-09-08). Сразу, не дожидаясь тика: между
   *  захватом и следующим `time.advanced` ангар иначе числился бы за новым хозяином. */
  api.on('planet.captured', (event, h: HandlerContext) => {
    const { planetId } = event.payload as { planetId?: string };
    if (typeof planetId !== 'string') return;
    const planet = h.state.planets[planetId];
    const lost = hangarUsed({ hangar: planet?.hangar });
    if (!planet || lost <= 0) return;
    planet.hangar = [];
    h.emit('shuttle.lost', {
      baseId: planetId,
      baseKind: 'planet',
      owner: planet.owner,
      count: lost,
    });
  });

  api.on('station.destroyed', (event, h: HandlerContext) => {
    const p = event.payload as { planetId?: string; owner?: string };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    if (!site) return;
    const lost = hangarUsed(site);
    delete site.hangar;
    delete site.sortie;
    if (lost > 0) h.emit('shuttle.lost', { baseId: site.id, baseKind: 'planet', owner: p.owner, count: lost });
  });
}

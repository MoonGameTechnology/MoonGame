/** Челноки: приказы игрока (`shuttle.*`). Разрезан из `../shuttle.ts` (SLIM). */
import type { ModuleSetupApi } from '../../kernel/module';
import type { Fleet, Planet, Squadron } from '../../state/gameState';
import type { HandlerContext } from '../../kernel/module';
import {
  aimPosition,
  mergeSquadrons,
  redirectAloft,
  relocateAloft,
  relocateDest,
  splitAloft,
  strikeAimOf,
} from './aloft';
import {
  baseFromPayload,
  flightTime,
  landingSpot,
  launchFlight,
  patrolCheck,
  readySquadron,
  takeOffPatrol,
  turnHome,
} from './flight';
import { basePosition, strikePosition } from '../../state/strikePosition';
import { distance } from '../../state/route';
import {
  divideSquadron,
  nextSquadronId,
  ownPatrol,
  ownStrike,
  reorder,
  requireSquadron,
  scheduleChase,
  scheduleFlight,
} from './kit';
import {
  fleetHoldFree,
  shuttleBayAt,
  squadronFerryRange,
  squadronReach,
  squadronSize,
  stacksSize,
} from '../../state/shuttle';
import { ownFleet } from '../../util/combat';
import { requireOwnedStationaryFleet } from '../../util/fleet';
import { serviceSitesForFleet } from '../../state/fortress';

/** Вылеты: удар, патруль, «Домой», новая цель в воздухе, «Держать патруль». */
export function registerLaunchOrders(api: ModuleSetupApi): void {
  /**
   * `shuttle.strike { planetId | fleetId, unit, count, targetFleetId | targetPlanetId }`
   * — вылет с базы. Челноки покидают ангар, летят по прямой к точке, снятой в момент
   * вылета, и после удара разворачиваются домой.
   *
   * База — мир с космопортом ИЛИ флот-носитель (SHU-2.1). Ровно одна из двух: обе
   * или ни одной — отказ (fail-secure; схема payload этого не выражает).
   *
   * Цель фиксируется КООРДИНАТОЙ, а не ссылкой: «навёлся и пустил». Цель может уйти —
   * челноки всё равно летят туда, куда их послали, и по прибытии бьют того, кто там
   * оказался. Иначе удар был бы самонаводящимся, а уклонение — невозможным.
   */
  api.onAction('shuttle.strike', (action, h: HandlerContext) => {
    const p = action.payload as {
      planetId?: string;
      fleetId?: string;
      squadronId?: string;
      targetFleetId?: string;
      targetPlanetId?: string;
    };
    const base = baseFromPayload(h, action.playerId, p ?? {});
    const ready = readySquadron(h, base, p?.squadronId);
    const squad = ready.squad;
    const aim = strikeAimOf(h, action.playerId, squad, p);
    const targetFleet = aim.fleet;
    const cargo = aim.cargo;

    const from = base.position;
    if (!from) return h.reject('E_NO_PORT'); // носитель без позиции (в перелёте) — не база
    const to = aimPosition(h, aim);
    if (!to) return h.reject('E_NO_TARGET_POSITION');

    // Радиус считается ОТ УЗЛА БАЗИРОВАНИЯ: своей позиции у челнока в ангаре нет.
    // У СОЕДИНЕНИЯ он по САМОЙ КОРОТКОЙ руке (SHU-4.2) — как и скорость по самой
    // медленной машине: эскадра идёт вместе, и дальность у неё общая.
    const range = squadronReach(squad, h.ctx.data);
    if (range <= 0) return h.reject('E_NO_RANGE');
    if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

    const strike = launchFlight(h, action.playerId, base, ready, {
      target: aim.target,
      to,
      arrivesAt: h.ctx.now + flightTime(h, squad, from, to),
      // ПОГОНЯ (SHU-4.4) заводится только на удар по ФЛОТУ: мир не двигается, и
      // догонять его нечем — туда эскадра идёт по расписанию, как и раньше.
      ...(targetFleet ? { at: { ...from } } : {}),
      ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
    });
    // Удар по МИРУ прилетает точно в срок, как и раньше. У ПОГОНИ срока нет — вместо
    // прибытия назначается первый пересчёт, и он же решит, когда эскадра дошла.
    if (targetFleet) scheduleChase(h, strike);
    else scheduleFlight(h, strike, strike.arrivesAt, 'shuttle.arrived');
  });

  /**
   * `shuttle.patrol { planetId | fleetId, squadronId, at: {x, y} }` — ПАТРУЛЬ В ТОЧКЕ
   * (SHU-6.2, резолюция владельца 2026-10-04, по образцу Conflict of Nations).
   *
   * Эскадра летит к точке как на удар — её видно, ПВО по трассе стреляет, — висит над
   * ней `patrolHours` и каждые `PATROL_TICK_MINUTES` бьёт одну цель в круге
   * `patrolRadius` (`patrolStrike`). Время вышло — домой, на обычную перезарядку;
   * `shuttle.recall` возвращает раньше.
   *
   * База та же, что у удара, и обе её формы: мир с портом или ангаром крепости и любой
   * корабль с трюмом, в том числе идущий. Точка — в радиусе удара эскадры от базы: круг,
   * который игрок видит у базы, обещает ровно то, куда патруль долетит. Тратится одна
   * единица запаса вылетов, как у удара.
   *
   * `hold: true` — «Держать патруль» (SHU-6.6): вернувшись, эскадра встанет снова сама.
   */
  api.onAction('shuttle.patrol', (action, h: HandlerContext) => {
    const p = (action.payload ?? {}) as {
      planetId?: unknown;
      fleetId?: unknown;
      squadronId?: unknown;
      at?: { x?: unknown; y?: unknown } | null;
      hold?: unknown;
    };
    if (p.hold !== undefined && typeof p.hold !== 'boolean') return h.reject('E_BAD_PAYLOAD');
    const base = baseFromPayload(h, action.playerId, p);
    const ready = readySquadron(h, base, p.squadronId);
    const x = p.at?.x;
    const y = p.at?.y;
    const to =
      typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
        ? { x, y }
        : null;
    const route = patrolCheck(h, base.position, ready.squad, to);
    if (typeof route === 'string') return h.reject(route);
    takeOffPatrol(h, action.playerId, base, ready, route, p.hold === true);
  });

  /**
   * `shuttle.recall { strikeId }` — «ДОМОЙ»: вернуть эскадру из воздуха раньше срока. С
   * SHU-6.2 — только патруль; с SHU-6.13 (владелец 2026-10-11: эскадре в воздухе можно
   * сменить приказ) — любой вылет на пути туда и в круге: удар по флоту бросает погоню,
   * десант везёт бойцов обратно в трюм. Разворот там, где эскадра сейчас, — не из точки
   * взлёта и не из точки цели.
   *
   * Обратной ноге «Домой» не нужно: она туда и летит (`E_RETURNING`). Сесть на другую
   * базу она может — `shuttle.relocate { strikeId }`.
   *
   * Отзыв снимает и «Держать патруль» (SHU-6.6): игрок вернул эскадру домой, и встать
   * снова сама она не должна.
   */
  api.onAction('shuttle.recall', (action, h: HandlerContext) => {
    const p = (action.payload ?? {}) as { strikeId?: unknown };
    const strike = ownStrike(h, action.playerId, p.strikeId);
    if (strike.leg === 'back') return h.reject('E_RETURNING');
    const here = strikePosition(strike, h.state, h.ctx.now);
    if (here) strike.to = here;
    delete strike.at;
    delete strike.patrol?.hold;
    reorder(strike);
    turnHome(h, strike);
  });

  /** `shuttle.redirect { strikeId, … }` — новая цель или точка патруля в воздухе
   *  (SHU-6.13, `redirectAloft`). */
  api.onAction('shuttle.redirect', (action, h: HandlerContext) => {
    redirectAloft(h, action.playerId, (action.payload ?? {}) as Record<string, unknown>);
  });

  /**
   * `shuttle.hold { strikeId, on }` — «ДЕРЖАТЬ ПАТРУЛЬ» у патруля в воздухе;
   * `shuttle.hold { planetId | fleetId, squadronId, on: false }` — снять удержание с
   * эскадры, которая ждёт дома перезарядки (SHU-6.6, резолюция владельца 2026-10-04:
   * патруль заменяет дежурный вылет).
   *
   * Включить можно, пока патруль не повернул домой, — там же, где его можно вернуть:
   * повернувший по отзыву держать уже нечего, игрок сам вернул его. Снять можно всегда,
   * в том числе на обратной ноге, дома и на корабле в бою: снять стоячий приказ должно
   * быть можно в любую минуту, как и любой другой. Дома включить нельзя — там нет
   * патруля, у которого взять точку: для этого есть сам приказ патруля с `hold`.
   */
  api.onAction('shuttle.hold', (action, h: HandlerContext) => {
    const p = (action.payload ?? {}) as {
      strikeId?: unknown;
      planetId?: unknown;
      fleetId?: unknown;
      squadronId?: unknown;
      on?: unknown;
    };
    if (typeof p.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
    if (p.strikeId !== undefined) {
      if (typeof p.strikeId !== 'string' || p.squadronId !== undefined) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const strike = ownPatrol(h, action.playerId, p.strikeId);
      if (!p.on) delete strike.patrol?.hold;
      else if (strike.leg === 'back' || !strike.patrol) return h.reject('E_NOT_PATROLLING');
      else strike.patrol.hold = true;
      return;
    }
    if (p.on) return h.reject('E_NOT_PATROLLING');
    const fromPlanet = typeof p.planetId === 'string';
    if (fromPlanet === (typeof p.fleetId === 'string')) return h.reject('E_BAD_PAYLOAD');
    let hangar: Squadron[];
    if (fromPlanet) {
      const planet = h.state.planets[p.planetId as string];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      hangar = planet.hangar ?? [];
    } else {
      // Чужой и несуществующий корабль — один ответ, как у всех приказов флота (A06).
      const fleet = ownFleet(h.state, p.fleetId as string);
      if (!fleet || fleet.owner !== action.playerId) return h.reject('E_NO_FLEET');
      hangar = fleet.hangar ?? [];
    }
    if (typeof p.squadronId !== 'string') return h.reject('E_BAD_PAYLOAD');
    const squad = hangar.find((q) => q.id === p.squadronId);
    if (!squad) return h.reject('E_NO_SQUADRON');
    delete squad.hold;
  });
}

/** Эскадры: перелёт, делёж, слияние, погрузка на носитель и выгрузка. */
export function registerSquadronOrders(api: ModuleSetupApi): void {
  /**
   * `shuttle.relocate { planetId | fleetId, squadronId, toPlanetId | toFleetId }` —
   * ПЕРЕБАЗИРОВАНИЕ (SHU-6.4, резолюция владельца 2026-10-04, по образцу Conflict of
   * Nations): эскадра перелетает на другую СВОЮ базу и остаётся там.
   *
   * Базы — обе формы с обеих сторон (уточнение владельца: «учти наши базы, в виде
   * трюмов»): мир с портом или ангаром крепости и любой корабль с трюмом, в том числе
   * идущий. Решения, которые легко потерять при правке:
   *
   * 1. **Дальность — два радиуса удара** (`squadronFerryRange`): радиус удара — туда и
   *    обратно, перелёт — в одну сторону. По самой короткой руке, как всё у эскадры.
   * 2. **Перелёт — обратная нога с самого взлёта.** Лететь на новую базу — то же, что
   *    возвращаться домой: та же позиция на карте, тот же зенит по трассе, та же посадка
   *    на живую позицию идущего корабля. Своей ноги и своего прибытия у перелёта нет —
   *    вторая копия посадки разъехалась бы с первой.
   * 3. **Место в трюме корабля держится с взлёта** (`strikesReserved` считает вылет,
   *    чья база — этот корабль): два перелёта на одно место иначе оба взлетели бы, а сел
   *    бы один.
   * 4. **Тратится один вылет базы, с которой ушли**, как у удара и патруля.
   * 5. **Боец летит с бортом.** Десантный челнок перебирается вместе со своим бойцом:
   *    это не высадка, на землю он не сходит.
   * 6. **Новая база не приняла — назад, а нет и дома — на ближайшую** (`divert`): тем же
   *    правилом садится и удар, чья база пропала, пока он был в воздухе.
   */
  api.onAction('shuttle.relocate', (action, h: HandlerContext) => {
    const p = (action.payload ?? {}) as Record<string, unknown>;
    // С эскадрой в воздухе — другая форма приказа (SHU-6.13).
    if (p.strikeId !== undefined) return relocateAloft(h, action.playerId, p);
    const base = baseFromPayload(h, action.playerId, p);
    const ready = readySquadron(h, base, p.squadronId);
    const squad = ready.squad;
    const dest = relocateDest(h, action.playerId, p);
    // На свою же базу — не перелёт, а пустой расход вылета.
    if (dest.kind === base.ref.kind && dest.id === base.ref.id) return h.reject('E_BAD_PAYLOAD');
    const spot = landingSpot(h, action.playerId, dest);
    if (!spot || spot.room < stacksSize(squad.units, h.ctx.data)) return h.reject('E_NO_CAPACITY');

    const from = base.position;
    if (!from) return h.reject('E_NO_PORT');
    const to = basePosition(dest, h.state, h.ctx.now);
    if (!to) return h.reject('E_NO_TARGET_POSITION');
    const range = squadronFerryRange(squad, h.ctx.data);
    if (range <= 0) return h.reject('E_NO_RANGE');
    if (distance(from, to) > range) return h.reject('E_OUT_OF_RANGE');

    const cargo = (squad.cargo ?? []).filter((st) => st.count > 0);
    const strike = launchFlight(h, action.playerId, base, ready, {
      target: { kind: 'base' },
      // Обратная нога идёт от `to` к базе: начало перелёта — точка взлёта.
      to: { ...from },
      arrivesAt: h.ctx.now + flightTime(h, squad, from, to),
      dest,
      ...(cargo.length > 0 ? { cargo: cargo.map((st) => ({ ...st })) } : {}),
    });
    scheduleFlight(h, strike, strike.arrivesAt, 'shuttle.arrived');
  });

  /**
   * `shuttle.split { planetId | fleetId, squadronId, units: [{unit,count}] }` —
   * отделить машины в НОВУЮ эскадру той же базы (SHU-4.2).
   * `shuttle.split { strikeId, units }` — то же в воздухе (SHU-6.13, `splitAloft`).
   * Кому достаётся имя и как делятся урон и десант — `divideSquadron`.
   */
  api.onAction('shuttle.split', (action, h: HandlerContext) => {
    const p = (action.payload ?? {}) as Record<string, unknown>;
    // В воздухе (SHU-6.13) эскадру адресует вылет, а не база: в ангаре её нет.
    if (p.strikeId !== undefined) return splitAloft(h, action.playerId, p);
    const base = baseFromPayload(h, action.playerId, p);
    const squad = requireSquadron(h, base, p.squadronId);
    const parts = divideSquadron(h, squad, p.units);
    const freshId = nextSquadronId(h, action.playerId);
    const named: Squadron = { id: squad.id, ...parts.named };
    const other: Squadron = { id: freshId, ...parts.other };
    base.setHangar(base.hangar.flatMap((q) => (q.id === squad.id ? [named, other] : [q])));
    h.emit('squadron.split', {
      baseId: base.ref.id,
      baseKind: base.ref.kind,
      owner: action.playerId,
      squadronId: squad.id,
      newId: freshId,
    });
  });

  api.onAction('shuttle.merge', mergeSquadrons);

  /**
   * `shuttle.load` / `shuttle.unload { fleetId, squadronId }` — перегрузка ЭСКАДРЫ
   * между космопортом мира и СТОЯЩИМ ТАМ ЖЕ носителем (SHU-2.1; с SHU-4.2 ездит
   * соединение целиком, а не россыпь машин). Ровно тот же шов, что у наземной армии
   * (`army.load`/`army.unload`): челнок строится в порту, но воевать вдали от своих
   * миров может только с борта.
   *
   * Эскадра переезжает ПОД СВОИМ ИМЕНЕМ: перегрузка — смена базы, а не роспуск
   * соединения. Груз в трюме едет вместе с ней — он стоит на её бортах.
   *
   * Обе стороны — СВОИ. Порт союзника не донор и не гараж: «помощь» иначе означала бы
   * вывоз чужой обороны, ровно как у `army.load`.
   */
  const transfer = (
    action: { playerId: string; payload: unknown },
    h: HandlerContext,
  ): { fleet: Fleet; planet: Planet; squadronId: string } => {
    const p = action.payload as { fleetId?: string; squadronId?: string; planetId?: string };
    if (typeof p?.fleetId !== 'string' || typeof p?.squadronId !== 'string') {
      return h.reject('E_BAD_PAYLOAD');
    }
    const fleet = requireOwnedStationaryFleet(h, p.fleetId, action.playerId);
    const ports = serviceSitesForFleet(h.state, fleet).filter((site) => site.owner === action.playerId);
    if (!p.planetId && fleet.location && h.state.planets[fleet.location]?.owner !== action.playerId) return h.reject('E_FORBIDDEN');
    const planet = p.planetId ? ports.find((site) => site.id === p.planetId)
      : ports.find((site) => site.id === fleet.location) ?? ports.find((site) => shuttleBayAt(site, h.ctx.data) > 0);
    if (!planet) return h.reject('E_NO_PLANET');
    if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
    return { fleet, planet, squadronId: p.squadronId };
  };

  /** Переезд эскадры между двумя ангарами одного узла. Форма ангара одна, поэтому и
   *  правило одно: своя копия на каждую сторону разъехалась бы. */
  const moveSquadron = (
    h: HandlerContext,
    from: { hangar?: Squadron[] },
    to: { hangar?: Squadron[] },
    squadronId: string,
    freeSpace: number,
  ): Squadron => {
    const squad = (from.hangar ?? []).find((q) => q.id === squadronId);
    if (!squad) return h.reject('E_NO_SQUADRON');
    if (stacksSize(squad.units, h.ctx.data) > freeSpace) return h.reject('E_NO_CAPACITY');
    from.hangar = (from.hangar ?? []).filter((q) => q.id !== squadronId);
    // «Держать патруль» (SHU-6.6) держится над СВОЕЙ базой: на новой базе точки нет.
    delete squad.hold;
    to.hangar = [...(to.hangar ?? []), squad];
    return squad;
  };

  api.onAction('shuttle.load', (action, h: HandlerContext) => {
    const { fleet, planet, squadronId } = transfer(action, h);
    const squad = moveSquadron(
      h,
      planet,
      fleet,
      squadronId,
      fleetHoldFree(h.state, fleet, h.ctx.data),
    );
    h.emit('shuttle.loaded', {
      fleetId: fleet.id,
      planetId: planet.id,
      squadronId: squad.id,
      count: squadronSize(squad),
      owner: action.playerId,
    });
  });

  api.onAction('shuttle.unload', (action, h: HandlerContext) => {
    const { fleet, planet, squadronId } = transfer(action, h);
    const squad = moveSquadron(
      h,
      fleet,
      planet,
      squadronId,
      shuttleBayAt(planet, h.ctx.data) > 0 ? Infinity : 0,
    );
    h.emit('shuttle.unloaded', {
      fleetId: fleet.id,
      planetId: planet.id,
      squadronId: squad.id,
      count: squadronSize(squad),
      owner: action.playerId,
    });
  });
}

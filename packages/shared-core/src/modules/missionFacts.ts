/**
 * Память фактов для задач забега (заказ владельца 2026-09-24: маяк «N часов подряд»,
 * спасательная операция «провал, если гарнизон пал», эвакуация «довести транспорты»).
 *
 * Задачи — чистые предикаты над состоянием (`decisions/missionObjectives.ts`), и почти
 * всё, что они спрашивают, в состоянии уже лежит. Три вопроса из одного кадра не
 * прочесть — ответ требует ПАМЯТИ, и её держит этот модуль:
 *
 * 1. **С какого момента провинция в этих руках** (`held`) — ставится на каждом захвате
 *    (`planet.captured`). Нет записи — провинция не переходила из рук в руки с начала
 *    матча. Отсюда «удерживать N часов подряд»: потеря и перезахват начинают счёт заново,
 *    а закончившаяся серия остаётся в `longest` — выполненное не отменяется потерей после.
 * 2. **Какие миры игрок терял** (`fallen`) — захват у прежнего владельца. Только растёт:
 *    «гарнизон пал» — это событие, отбить мир назад его не отменяет.
 * 3. **Сколько беженцев доставлено** (`evacuated`) — флот, прибывший в СВОЮ провинцию
 *    с признаком `haven` (убежище), высаживает юниты с признаком `evacuee`: они уходят
 *    из флота в счёт игрока. Опустевший флот удаляется.
 * 4. **О каких местах эпизода игрок получил сведения** (`found`) — провинция с признаком
 *    `refuge` попала в его опознанные: его зрением или зрением союзника (глава VI §8.4,
 *    PVR-8.4). Один раз на игрока и место, событие `refuge.found`; потеря обзора факта не
 *    отменяет. Не по таймеру и не даром: только то, что сторона действительно увидела.
 *
 * Ещё модуль выпускает в игру флоты, которые карта держит ждущими (`joinsOnArrival`,
 * `Planet.awaitingFleets`): транспорты беженцев появляются, когда флот игрока или его
 * союзника ПРИБЫЛ к ним с живым кораблём (заказ владельца 2026-09-29; союзник — PVR-8.4), а
 * не с первой секунды забега.
 *
 * Модуль ничего не знает о задачах: он пишет общие факты, а какая задача их читает,
 * решают данные карты. Нет задач — факты копятся и никому не мешают (правило «нет
 * модуля → база, а не падение» здесь в обратную сторону: нет читателя → нет эффекта).
 */
import type { GameModule } from '../kernel/module';
import type { HandlerContext } from '../kernel/module';
import type { MissionFacts } from '../state/gameState';
import { getStance } from '../state/diplomacy';
import { identifiedNodes } from '../state/visibility';

/** Признак провинции-убежища: сюда доводят беженцев. */
export const HAVEN_TRAIT = 'haven';
/** Признак юнита-беженца: транспорт с людьми, которого доводят до убежища. */
export const EVACUEE_TRAIT = 'evacuee';
/** Признак места эпизода: сведения о нём открывают сюжет главы (доки главы VI, §8.4). */
export const REFUGE_TRAIT = 'refuge';

function facts(h: HandlerContext): MissionFacts {
  return (h.state.missionFacts ??= {});
}

/** Ждущие флоты владельца прибывшего флота и его союзников входят в игру под своими id.
 *  Курс, пролёт, десант без корабля и флот не-союзника их не выпускают. */
function releaseAwaiting(h: HandlerContext, fleetId: string, at: string): void {
  const fleet = h.state.fleets[fleetId];
  const planet = h.state.planets[at];
  if (!fleet || !planet?.awaitingFleets || fleet.location !== at || fleet.movement) return;
  const alive = fleet.units.some(
    (u) => u.count > 0 && (u.hp ?? 1) > 0 && h.ctx.data.units[u.unit]?.domain === 'space',
  );
  if (!alive) return;
  // Своя сторона: тот же владелец (стойка с собой — союз) или союзник (PVR-8.4, §8.4).
  const ours = (owner: string): boolean => getStance(h.state, owner, fleet.owner) === 'alliance';
  const joining = planet.awaitingFleets.filter((f) => ours(f.owner));
  if (joining.length === 0) return;
  const rest = planet.awaitingFleets.filter((f) => !ours(f.owner));
  if (rest.length > 0) planet.awaitingFleets = rest;
  else delete planet.awaitingFleets;
  for (const f of joining) {
    // Id занят (невозможно для карты, но не повод затереть чужой флот) — ждущий не входит.
    if (h.state.fleets[f.id]) continue;
    h.state.fleets[f.id] = { ...f, location: at, movement: null };
    h.emit('fleet.joined', { owner: f.owner, fleetId: f.id, at });
  }
}

/** Сведения о местах эпизода (факт 4): каждому живому игроку — не жителю карты и не врагу
 *  штурма — место, попавшее в его опознанные (зрение блока включает союзника). Дёшево там,
 *  где мест нет или все уже известны: опознанное считается, только пока есть что открыть. */
function discover(h: HandlerContext): void {
  const sites = Object.keys(h.state.planets)
    .filter((id) => h.state.planets[id]!.traits.includes(REFUGE_TRAIT))
    .sort();
  if (sites.length === 0) return;
  const enemy = h.state.pve?.npcPlayerId;
  for (const playerId of Object.keys(h.state.players).sort()) {
    const player = h.state.players[playerId]!;
    if (player.npc || playerId === enemy || player.status !== 'active') continue;
    const known = h.state.missionFacts?.found?.[playerId] ?? [];
    const unknown = sites.filter((id) => !known.includes(id));
    if (unknown.length === 0) continue;
    const seen = identifiedNodes(h.state, playerId, h.ctx.data);
    for (const id of unknown) {
      if (!seen.has(id)) continue;
      ((facts(h).found ??= {})[playerId] ??= []).push(id);
      h.emit('refuge.found', { owner: playerId, at: id });
    }
  }
}

export const missionFactsModule: GameModule = {
  id: 'missionFacts',
  // 1.2.0 — сведения о местах эпизода (`found`) и выпуск ждущих флотом союзника (PVR-8.4).
  version: '1.2.0',
  setup(api) {
    api.on('planet.captured', (event, h) => {
      const p = event.payload as { planetId?: unknown; owner?: unknown; from?: unknown };
      if (typeof p.planetId !== 'string' || typeof p.owner !== 'string') return;
      const f = facts(h);
      // Серия прежнего держателя закончилась — запомнить, если она длиннейшая.
      const was = f.held?.[p.planetId];
      if (was && was.owner !== p.owner) {
        const streaks = ((f.longest ??= {})[p.planetId] ??= {});
        streaks[was.owner] = Math.max(streaks[was.owner] ?? 0, h.ctx.now - was.since);
      }
      (f.held ??= {})[p.planetId] = { owner: p.owner, since: h.ctx.now };
      if (typeof p.from === 'string' && p.from !== p.owner) {
        const lost = ((f.fallen ??= {})[p.from] ??= []);
        if (!lost.includes(p.planetId)) lost.push(p.planetId);
      }
    });

    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (typeof p.fleetId !== 'string' || typeof p.at !== 'string') return;
      releaseAwaiting(h, p.fleetId, p.at);
      const fleet = h.state.fleets[p.fleetId];
      const planet = h.state.planets[p.at];
      if (!fleet || !planet || planet.owner !== fleet.owner) return;
      if (!planet.traits.includes(HAVEN_TRAIT)) return;
      const evacuee = (unit: string): boolean =>
        h.ctx.data.units[unit]?.traits.includes(EVACUEE_TRAIT) ?? false;
      let delivered = 0;
      for (const stack of fleet.units) if (evacuee(stack.unit)) delivered += stack.count;
      if (delivered <= 0) return;
      fleet.units = fleet.units.filter((stack) => !evacuee(stack.unit));
      const f = facts(h);
      (f.evacuated ??= {})[fleet.owner] = (f.evacuated[fleet.owner] ?? 0) + delivered;
      h.emit('evac.delivered', { owner: fleet.owner, at: p.at, count: delivered });
      if (fleet.units.length === 0 && (fleet.landing ?? []).length === 0)
        delete h.state.fleets[fleet.id];
    });

    // Сведения о местах эпизода: обзор меняется с ходом флотов, прибытием и захватом. После
    // фактов выше — чтобы смотрели и флоты, выпущенные этим же прибытием.
    for (const type of ['time.advanced', 'planet.captured', 'fleet.arrived'] as const)
      api.on(type, (_event, h) => discover(h));
  },
};

/**
 * Сценарный союзник (глава IV «Архив без ответа», `docs/sector-zero-map-concepts.md` §6.3–§6.4,
 * кирпич PVR-7.2).
 *
 * Карта объявляет место встречи полем провинции `rendezvous: <id жителя>`. Первое
 * ПОДТВЕРЖДЁННОЕ прибытие туда флота игрока хотя бы с одним живым кораблём — это контакт:
 *
 * 1. записывается факт `missionFacts.contacted[игрок]` — исторический, а не условие
 *    владения: уход флота, потеря провинции и восстановление сохранения его не отменяют;
 * 2. стойка игрока и жителя становится `alliance`. Общий обзор и синий цвет уже держатся на
 *    этой стойке (`visionBloc` в `state/visibility.ts`, `relationColor` у клиента), поэтому
 *    обзор двусторонний и обновляется по наблюдениям обоих — отдельного механизма нет;
 * 3. уходит событие `ally.contact` — по нему клиент ставит в очередь страницу встречи.
 *
 * Не засчитывают контакт: указание курса, открытие точки радаром, пролёт через неё
 * (`fleet.transit`), прибытие чужого флота, флот без живого корабля. Повторное прибытие,
 * несколько прибытий в один миг и повторная обработка события ничего не дублируют: факт
 * уже лежит в состоянии.
 *
 * ПОЧЕМУ СТОЙКА СТАВИТСЯ ЗДЕСЬ, А НЕ ЧЕРЕЗ `diplomacy.declare`. Обычная дипломатия отклоняет
 * союз с ботом (`E_BOT_ALLIANCE`), и этот запрет остаётся в силе для всех остальных пар.
 * Союз главы IV ставит авторитетная логика сценария — так же, как загрузчик командной карты
 * сажает ИИ-напарника в союз, минуя ворота объявления (`seedTeamDiplomacy`). Житель не
 * становится игровым местом: он не судится PvE-вердиктом и не участвует в гонке очков.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { AllyOperation, GameState, PlayerId } from '../state/gameState';
import { getStance, setStance } from '../state/diplomacy';
import { identifiedNodes } from '../state/visibility';

/** С кем игрок уже установил связь: жители из `rendezvous` провинций, где он побывал. */
export function contactedAllies(state: GameState, player: PlayerId): PlayerId[] {
  const places = state.missionFacts?.contacted?.[player] ?? [];
  const out: PlayerId[] = [];
  for (const at of places) {
    const ally = state.planets[at]?.rendezvous;
    if (ally && !out.includes(ally)) out.push(ally);
  }
  return out;
}

function contactOnArrival(h: HandlerContext, fleetId: string, at: string): void {
  const fleet = h.state.fleets[fleetId];
  const planet = h.state.planets[at];
  const allyId = planet?.rendezvous;
  if (!fleet || !planet || !allyId) return;
  // Прибыл именно этот флот и стоит на месте: курс и пролёт — не прибытие.
  if (fleet.location !== at || fleet.movement) return;
  const player = h.state.players[fleet.owner];
  if (!player || player.ai || player.npc || player.status !== 'active') return;
  const ally = h.state.players[allyId];
  if (!ally || !ally.npc || ally.status !== 'active') return;
  // Хотя бы один живой корабль: десант, пустой флот и мёртвый стек встречу не проводят.
  const alive = fleet.units.some(
    (u) => u.count > 0 && (u.hp ?? 1) > 0 && h.ctx.data.units[u.unit]?.domain === 'space',
  );
  if (!alive) return;
  const facts = (h.state.missionFacts ??= {});
  const mine = ((facts.contacted ??= {})[fleet.owner] ??= []);
  if (mine.includes(at)) return;
  mine.push(at);
  const from = getStance(h.state, fleet.owner, allyId);
  setStance(h.state, fleet.owner, allyId, 'alliance');
  if (from !== 'alliance')
    h.emit('diplomacy.changed', { a: fleet.owner, b: allyId, stance: 'alliance', from });
  h.emit('ally.contact', { owner: fleet.owner, ally: allyId, at });
}

const ORDER_KINDS: ReadonlySet<string> = new Set(['guard', 'attack', 'scout']);

/** Можно ли войти в провинцию: непроходимый вид (дыра, разлом) целью не бывает. */
function enterable(h: HandlerContext, planetId: string): boolean {
  const planet = h.state.planets[planetId];
  if (!planet) return false;
  return h.ctx.data.sectorKinds[planet.kind ?? '']?.traversable !== false;
}

/** Снять операцию жителя с поводом (`done` — выполнена, `lost` — цель потеряна). */
function closeOp(h: HandlerContext, ally: PlayerId, outcome: 'done' | 'lost'): void {
  const op = h.state.allyOps?.[ally];
  if (!op) return;
  delete h.state.allyOps![ally];
  if (Object.keys(h.state.allyOps!).length === 0) delete h.state.allyOps;
  h.emit(`ally.order.${outcome}`, {
    ally,
    owner: op.by,
    kind: op.kind,
    planet: op.planet,
    fleet: op.fleet,
  });
}

/** Операции, которые событие касается: по цели-провинции или цели-флоту. */
function opsOn(state: GameState, match: (op: AllyOperation) => boolean): PlayerId[] {
  return Object.keys(state.allyOps ?? {})
    .sort()
    .filter((ally) => match(state.allyOps![ally]!));
}

export const rendezvousModule: GameModule = {
  id: 'rendezvous',
  version: '1.1.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (typeof p.fleetId !== 'string' || typeof p.at !== 'string') return;
      contactOnArrival(h, p.fleetId, p.at);
      // Разведчик союзника дошёл до цели — сведения свежие, операция выполнена (§6.5).
      const fleet = h.state.fleets[p.fleetId];
      if (!fleet) return;
      for (const ally of opsOn(h.state, (op) => op.kind === 'scout' && op.planet === p.at))
        if (fleet.owner === ally) closeOp(h, ally, 'done');
    });

    /**
     * Приказ союзнику (§6.5): «Охранять», «Атаковать», «Разведать». Отдаёт тот, кто
     * установил с ним связь; одна операция на жителя — новый приказ ЯВНО заменяет прежний,
     * а повтор того же не сбрасывает подготовку и не множит операцию (`E_ALREADY`).
     * Исполняет приказ бот союзника (`decisions/allyOperation.ts`); здесь — только право
     * отдать приказ и его цель.
     */
    api.onAction('ally.order', (action, h) => {
      const { ally, kind, planet, fleet } = (action.payload ?? {}) as {
        ally?: unknown;
        kind?: unknown;
        planet?: unknown;
        fleet?: unknown;
      };
      if (typeof ally !== 'string' || typeof kind !== 'string' || !ORDER_KINDS.has(kind))
        return h.reject('E_BAD_PAYLOAD');
      const hasPlanet = typeof planet === 'string';
      const hasFleet = typeof fleet === 'string';
      if (hasPlanet === hasFleet || (kind === 'scout' && !hasPlanet))
        return h.reject('E_BAD_PAYLOAD');
      const me = action.playerId;
      const player = h.state.players[me];
      if (!player || player.npc || player.ai || player.status !== 'active')
        return h.reject('E_FORBIDDEN');
      const seat = h.state.players[ally];
      if (!seat || !seat.npc || seat.status !== 'active') return h.reject('E_NO_PLAYER');
      if (
        !contactedAllies(h.state, me).includes(ally) ||
        getStance(h.state, me, ally) !== 'alliance'
      )
        return h.reject('E_NO_CONTACT');
      const friendly = (owner: PlayerId | null): boolean =>
        owner === null ||
        owner === me ||
        owner === ally ||
        getStance(h.state, ally, owner) === 'alliance';
      const hostile = (owner: PlayerId | null): boolean =>
        owner !== null && getStance(h.state, ally, owner) === 'war';
      if (hasPlanet) {
        const target = h.state.planets[planet as string];
        if (!target || !enterable(h, target.id)) return h.reject('E_BAD_TARGET');
        // Охранять — своё и дружественное; атаковать — только того, с кем союзник воюет;
        // разведывать своё незачем.
        if (kind === 'guard' && !friendly(target.owner)) return h.reject('E_BAD_TARGET');
        if (kind === 'attack' && !hostile(target.owner)) return h.reject('E_NOT_HOSTILE');
        if (kind === 'scout' && (target.owner === me || target.owner === ally))
          return h.reject('E_BAD_TARGET');
      } else {
        const target = h.state.fleets[fleet as string];
        if (!target) return h.reject('E_BAD_TARGET');
        if (kind === 'guard' && target.owner !== me && target.owner !== ally)
          return h.reject('E_BAD_TARGET');
        if (kind === 'attack') {
          if (!hostile(target.owner)) return h.reject('E_NOT_HOSTILE');
          // Атаковать можно ОБНАРУЖЕННЫЙ флот: он стоит там, что игрок с союзником видят.
          if (!target.location || !identifiedNodes(h.state, me, h.ctx.data).has(target.location))
            return h.reject('E_BAD_TARGET');
        }
      }
      const prev = h.state.allyOps?.[ally];
      const same =
        prev &&
        prev.kind === kind &&
        prev.planet === (planet ?? undefined) &&
        prev.fleet === (fleet ?? undefined);
      if (same) return h.reject('E_ALREADY');
      const op: AllyOperation = {
        by: me,
        kind: kind as AllyOperation['kind'],
        ...(hasPlanet ? { planet: planet as string } : { fleet: fleet as string }),
        issuedAt: h.ctx.now,
      };
      (h.state.allyOps ??= {})[ally] = op;
      h.emit('ally.ordered', {
        ally,
        owner: me,
        kind,
        planet: op.planet,
        fleet: op.fleet,
        replaced: prev !== undefined,
      });
      // Разведчик союзника УЖЕ стоит в цели — сведения свежие прямо сейчас: доклад сразу.
      // Иначе операция ждала бы прибытия, которого не будет.
      if (
        kind === 'scout' &&
        Object.values(h.state.fleets).some(
          (f) => f.owner === ally && f.location === planet && !f.movement,
        )
      )
        closeOp(h, ally, 'done');
    });

    /** Отмена освобождает силы союзника; начавшийся бой не прерывается — это решает бой. */
    api.onAction('ally.cancel', (action, h) => {
      const { ally } = (action.payload ?? {}) as { ally?: unknown };
      if (typeof ally !== 'string') return h.reject('E_BAD_PAYLOAD');
      const op = h.state.allyOps?.[ally];
      if (!op) return h.reject('E_NO_ORDER');
      if (!contactedAllies(h.state, action.playerId).includes(ally))
        return h.reject('E_NO_CONTACT');
      delete h.state.allyOps![ally];
      if (Object.keys(h.state.allyOps!).length === 0) delete h.state.allyOps;
      h.emit('ally.order.cancelled', { ally, owner: action.playerId, kind: op.kind });
    });

    // Цель-провинция сменила хозяина: атака удалась, если её взяла дружественная сторона;
    // охрана потеряна, если её взял враг.
    api.on('planet.captured', (event, h) => {
      const p = event.payload as { planetId?: unknown; owner?: unknown };
      if (typeof p.planetId !== 'string' || typeof p.owner !== 'string') return;
      const owner = p.owner;
      for (const ally of opsOn(h.state, (op) => op.planet === p.planetId)) {
        const op = h.state.allyOps![ally]!;
        const friendly =
          owner === ally || owner === op.by || getStance(h.state, ally, owner) === 'alliance';
        if (op.kind === 'attack' && friendly) closeOp(h, ally, 'done');
        else if (op.kind === 'guard' && !friendly) closeOp(h, ally, 'lost');
      }
    });

    // Цель-флот уничтожен: атака выполнена, охранять больше некого.
    api.on('fleet.destroyed', (event, h) => {
      const p = event.payload as { fleetId?: unknown };
      for (const ally of opsOn(h.state, (op) => op.fleet !== undefined && op.fleet === p.fleetId))
        closeOp(h, ally, h.state.allyOps![ally]!.kind === 'attack' ? 'done' : 'lost');
    });

    // Цель-флот влился в другой — операция идёт за ним, а не теряет цель.
    api.on('fleet.merged', (event, h) => {
      const p = event.payload as { from?: unknown; into?: unknown };
      if (typeof p.into !== 'string') return;
      for (const ally of opsOn(h.state, (op) => op.fleet !== undefined && op.fleet === p.from))
        h.state.allyOps![ally]!.fleet = p.into;
    });

    // Союзник выбыл — приказывать некому.
    api.on('player.eliminated', (event, h) => {
      const p = event.payload as { playerId?: unknown };
      if (typeof p.playerId === 'string' && h.state.allyOps?.[p.playerId])
        closeOp(h, p.playerId, 'lost');
    });
  },
};

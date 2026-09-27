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
import type { GameState, PlayerId } from '../state/gameState';
import { getStance, setStance } from '../state/diplomacy';

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

export const rendezvousModule: GameModule = {
  id: 'rendezvous',
  version: '1.0.0',
  setup(api) {
    api.on('fleet.arrived', (event, h) => {
      const p = event.payload as { fleetId?: unknown; at?: unknown };
      if (typeof p.fleetId !== 'string' || typeof p.at !== 'string') return;
      contactOnArrival(h, p.fleetId, p.at);
    });
  },
};

import type { GameModule, HandlerContext } from '../kernel/module';
import type { ResourceBag } from '../data/schemas';
import { canAfford, payCost } from '../util/treasury';
import { isStationable } from '../state/sectorKind';

/**
 * КОСМИЧЕСКАЯ КРЕПОСТЬ (`fortress-roadmap.md` §0.6, решение владельца 2026-09-15).
 *
 * Местность на карте почти вся незастраиваема: на туманности, кладбище, ионном шторме,
 * плотной туманности и вспышке нельзя возвести НИЧЕГО. Это 90 узлов из 121 на карте
 * прототипа — декорация с бонусами к скорости и живучести. Крепость — тот шаг, который
 * превращает захваченную декорацию в развиваемое владение с орбитой и своим ростером
 * построек: захват делает узел твоим, крепость делает его полезным.
 *
 * `station.deploy` переводит СВОЙ узел в вид `void_station`, после чего обычный
 * `building.construct` поднимает на нём радар, верфь, форт и прочее из ростера вида.
 * Крепость — настоящее владение: оставил без прикрытия, и враг занимает её прилётом,
 * как любой другой узел.
 *
 * ДВА ПРАВИЛА, И ОБА ПРИШЛИ ОТ ВЛАДЕЛЬЦА, А НЕ ИЗ УДОБСТВА КОДА:
 *
 * 1. **Только на ЗАХВАЧЕННОЙ территории.** Прежде требовался флот-якорь на узле; теперь
 *    доказательством служит само владение — там, где ты не был, узел твоим не стал бы.
 *    Это заодно закрывает незахватываемые виды (пустота, обломки, чёрная дыра) без
 *    отдельного запрета: своими они не становятся никогда.
 * 2. **На всех видах, кроме тех, где уже есть планета** — и кроме уже стоящей крепости.
 *    Правило живёт В ДАННЫХ (`sectorKinds.stationable`), а не строкой `'planet'` здесь:
 *    иначе каждый новый вид местности пришлось бы вспоминать руками.
 *
 * Прежняя форма требовала узел вида `empty` и технический юнит-конвертер; и то и другое
 * снято решением владельца, см. §0.6 роадмапа («что эти решения отменяют»).
 *
 * New mechanic = new module + data; the kernel is untouched, state stays pure JSON.
 */

const STATION_KIND = 'void_station';
/** Цена крепости. ЭКСПОРТИРУЕТСЯ намеренно: кнопку рисует клиент, и своя копия числа у
 *  него — это ровно тот способ, которым интерфейс начинает обещать то, что редьюсер
 *  отклоняет (прецедент ORB-4 записан в `main.ts`: три собственных `?? BUILDABLE` развели
 *  клиентское правило с данными). Одно число, один дом. */
export const STATION_COST: ResourceBag = { metal: 120 };

export const stationModule: GameModule = {
  id: 'station',
  version: '1.0.0',
  setup(api) {
    api.onAction('station.deploy', (action, h: HandlerContext) => {
      const { planetId } = action.payload as { planetId?: string };
      if (typeof planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const node = h.state.planets[planetId];
      if (!node) return h.reject('E_NO_PLANET');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN'); // not a participant / no treasury
      // Правило 1: только СВОЙ узел. Чужой и ничейный отбиваются одним кодом намеренно —
      // fail-secure: отказ не обязан рассказывать, чей узел на самом деле.
      if (node.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      // Правило 2: вид должен принимать крепость. Уже стоящая крепость отбивается тем же
      // флагом (`void_station.stationable: false`), поэтому «второй раз» — не отдельная
      // ветка, а тот же запрет.
      if (!isStationable(h.ctx.data, node)) return h.reject('E_NOT_STATIONABLE');
      if (!canAfford(player.resources, STATION_COST)) return h.reject('E_INSUFFICIENT');

      payCost(player.resources, STATION_COST);
      node.kind = STATION_KIND; // ownable + buildable: radar/fort/… via building.construct
      h.emit('station.deployed', { planetId, owner: action.playerId });
    });
  },
};

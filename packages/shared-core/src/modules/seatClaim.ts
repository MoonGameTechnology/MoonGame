import type { GameModule, HandlerContext } from '../kernel/module';

/**
 * Заявка на место в сетевой партии (ENTRY-3).
 *
 * Игрок видит открытую сессию в ленте, заходит и выбирает — как в одиночной «Настройке
 * схватки», только партия уже живёт: свободный мир, дом и совет учёных в ЭТУ сессию.
 * Первые два до сих пор применялись мимо редьюсера — сервер писал `player.faction`
 * прямо в состояние комнаты на входе (BF-30). Работало, но **ломало реплей**: лог
 * состоит из стартового снимка плюс записанных действий (`replayDeterminism.test.ts`),
 * а мутация мимо редьюсера в лог не попадает — воспроизведение выдавало дом из
 * стартового снимка, то есть другие пассивки и другой радиус радара. На живой игре это
 * не сказывалось (снапшот пишется уже изменённым), ломался аудит и античит — ровно то,
 * ради чего строился RPL-1..3. Совет учёных влияет на исследования, то есть на весь ход
 * партии, поэтому добавлять его тем же способом было нельзя.
 *
 * Теперь заявка — действие: она в логе, она детерминирована, она проверяется здесь.
 *
 * 1. **Заявить место можно ОДИН раз.** Маркер живёт в состоянии, а не в памяти сервера:
 *    `seat.claim` — клиентский тип, игрок может прислать его сам, поэтому «один раз»
 *    обязан держать редьюсер. Иначе дом и совет менялись бы посреди партии — а совет
 *    объявлен неизменяемым (`gameState.ts`), и его бонусы уже учтены в исследованиях.
 * 2. **Дом сверяется с КАТАЛОГОМ ДАННЫХ.** Ядро знает данные, а не то, что клиенту
 *    показали: `data.factions[...]` кормит пассивки, стартовый набор и радар, поэтому
 *    неизвестный id молча обнулил бы игроку все бонусы дома. Сверку «дом был в
 *    предложении» делает сервер раньше (`joinSeat.ts`) — это разные вопросы, и оба нужны.
 * 3. **Совет — те же правила, что при создании матча.** ≤2 различных известных учёных,
 *    и коды отказа те же (`E_UNKNOWN_SCIENTIST` / `E_DUPLICATE_SCIENTIST` /
 *    `E_TOO_MANY_SCIENTISTS`), что у `resolveScientists` в `buildFromMap.ts`. Расходиться
 *    им нельзя: игрок не должен видеть разные ответы на одну и ту же ошибку в
 *    зависимости от того, задал он состав при создании партии или при входе в неё.
 * 4. **Пустая заявка законна.** Можно взять место, ничего не выбрав: остаётся дом,
 *    приписанный месту в раскладе, и пустой совет. Требовать выбор значило бы запретить
 *    вход тому, кто просто хочет сесть и играть.
 * 5. **Заявляется только СВОЁ место.** Действие применяется к `action.playerId` —
 *    к тому месту, которое авторизовал шлюз. Чужое место здесь недостижимо в принципе:
 *    идентификатор места не читается из payload.
 * 6. **Место закрепляется не заявкой, а ПОПАДАНИЕМ НА КАРТУ.** Заявка временная:
 *    человек может открыть ссылку, выбрать дом и не прийти — и кресло стояло бы
 *    занятым до конца партии, а в матче на десять мест это убивает сессию. Поэтому
 *    `seat.confirm` (сервер подаёт его, когда игрок дошёл до карты) ставит `seated`,
 *    и только с этого момента место неотзывное.
 * 7. **Неподтверждённая заявка истекает по РЕАЛЬНОМУ времени.** Окно живёт снаружи —
 *    сервер решает, когда пора, и подаёт `seat.release`; модуль лишь следит, чтобы
 *    отпускалось ровно неподтверждённое. Реальное время выводится из игрового делением
 *    на `timeScale` (так же считает окно входа, `MatchRegistry.entryOpen`): настенных
 *    часов в состоянии нет, иначе реплей стал бы невоспроизводимым.
 *
 * 8. **Отобрать закреплённое место может только АДМИНИСТРАТОР — отдельным действием.**
 *    Правило 6 обещает игроку: дошёл до карты — кресло твоё, и `seat.release` это
 *    обещание держит (`E_SEAT_SEATED`). Но на живом плейтесте нужна власть убрать
 *    того, кто мешает или занял место и не играет, — иначе партия на десять мест
 *    чинится только рестартом. Поэтому власть НАЗВАНА: `seat.kick` — то же самое,
 *    что `seat.release`, но снимает и `seated`. Отдельное действие, а не флаг у
 *    `release`, ровно затем, чтобы в логе реплея было видно, что место освободили
 *    ВЛАСТЬЮ, а не по истечении окна: это разные события с разной ответственностью.
 *    Империя при этом остаётся на карте — снимается только человек с кресла, и
 *    следующий вошедший садится в него как в свободное (правило 1 снова проходит).
 *
 * `seat.confirm`, `seat.release` и `seat.kick` — СЕРВЕРНЫЕ: у них намеренно нет
 * payload-схемы, поэтому шлюз не пропустит их от клиента (`isValidActionPayload`).
 * Игрок не должен уметь ни закрепить за собой место в обход прихода на карту, ни
 * отпустить чужое, ни тем более выкинуть соседа.
 */

/** Максимум учёных в совете — зеркалит `resolveScientists` в `buildFromMap.ts`. */
const COUNCIL_MAX = 2;

export const seatClaimModule: GameModule = {
  id: 'seatClaim',
  version: '1.0.0',
  setup(api) {
    api.onAction('seat.claim', (action, h: HandlerContext) => {
      const payload = action.payload as { faction?: unknown; scientists?: unknown };

      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_UNKNOWN_PLAYER'); // правило 5
      if (player.claimedAt !== undefined) return h.reject('E_SEAT_CLAIMED'); // правило 1

      // --- дом (правила 2, 4) ---
      const faction = payload.faction;
      if (faction !== undefined) {
        if (typeof faction !== 'string' || faction === '') return h.reject('E_BAD_PAYLOAD');
        if (!h.ctx.data.factions[faction]) return h.reject('E_UNKNOWN_FACTION');
      }

      // --- совет (правила 3, 4) ---
      const raw = payload.scientists;
      let council: Array<{ id: string; level: number }> | undefined;
      if (raw !== undefined) {
        if (!Array.isArray(raw)) return h.reject('E_BAD_PAYLOAD');
        if (raw.length > COUNCIL_MAX) return h.reject('E_TOO_MANY_SCIENTISTS');
        const seen = new Set<string>();
        council = [];
        for (const entry of raw) {
          if (typeof entry !== 'string' || entry === '') return h.reject('E_BAD_PAYLOAD');
          if (!h.ctx.data.scientists[entry]) return h.reject('E_UNKNOWN_SCIENTIST');
          if (seen.has(entry)) return h.reject('E_DUPLICATE_SCIENTIST');
          seen.add(entry);
          // Уровень — метапрогресс аккаунта, его сюда не пускают: клиент назвал бы себе
          // любой. Заявка даёт базовый; повышение приезжает отдельным путём (мета-грант).
          council.push({ id: entry, level: 1 });
        }
      }

      // Всё проверено — только теперь пишем. Частично применённая заявка была бы хуже
      // отказа: место числилось бы заявленным с половиной выбора.
      if (typeof faction === 'string') player.faction = faction;
      if (council !== undefined) player.scientists = council;
      player.claimedAt = h.ctx.now;

      // Адресат назван `playerId` — ключ из фог-фильтра сервера (`eventVisibleTo`),
      // иначе событие молча не дойдёт до самого заявителя.
      h.emit('seat.claimed', {
        playerId: action.playerId,
        faction: player.faction,
        scientists: (player.scientists ?? []).map((s) => s.id),
      });
    });

    // Правило 6. Серверное: подаётся, когда игрок дошёл до карты.
    api.onAction('seat.confirm', (action, h: HandlerContext) => {
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_UNKNOWN_PLAYER');
      // Подтверждать нечего, если места не заявляли: иначе `seated` можно было бы
      // поставить месту, за которое никто не садился, и оно перестало бы истекать.
      if (player.claimedAt === undefined) return h.reject('E_SEAT_UNCLAIMED');
      if (player.seated) return; // уже за столом — повтор безвреден, не отказ
      player.seated = true;
      h.emit('seat.seated', { playerId: action.playerId });
    });

    // Правило 7. Серверное: окно истекло, место возвращается в оборот.
    api.onAction('seat.release', (action, h: HandlerContext) => {
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_UNKNOWN_PLAYER');
      if (player.claimedAt === undefined) return h.reject('E_SEAT_UNCLAIMED');
      // Закреплённое место не отзывается ничем — это и есть смысл правила 6.
      if (player.seated) return h.reject('E_SEAT_SEATED');
      delete player.claimedAt;
      // Выбор снимается вместе с заявкой: место возвращается в оборот таким, каким его
      // застанет следующий игрок, а не с чужим советом и чужим домом.
      delete player.scientists;
      // Отметка «кресло освободилось вот сейчас» — из неё следующая заявка возьмёт
      // свой идентификатор действия (см. `freedAt` в `gameState.ts`). Без неё заявка
      // нового игрока дедуплится квитанцией старого и молча не применяется.
      player.freedAt = h.ctx.now;
      h.emit('seat.released', { playerId: action.playerId });
    });

    // Правило 8. Серверное: администратор снимает человека с кресла. Отличие от
    // `seat.release` — ровно одно и намеренное: снимается и `seated`.
    api.onAction('seat.kick', (action, h: HandlerContext) => {
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_UNKNOWN_PLAYER');
      // Пустое кресло выкинуть нельзя: это значит, что у администратора на экране
      // устаревший состав, и честнее сказать это, чем отчитаться об успехе.
      if (player.claimedAt === undefined) return h.reject('E_SEAT_UNCLAIMED');
      delete player.claimedAt;
      delete player.seated;
      delete player.scientists;
      player.freedAt = h.ctx.now; // та же отметка, что у `seat.release`
      // Событие СВОЁ, не `seat.released`: по логу должно быть видно, что место
      // освободили властью, а не по истечении окна (правило 8).
      h.emit('seat.kicked', { playerId: action.playerId });
    });
  },
};

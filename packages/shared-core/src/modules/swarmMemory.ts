/**
 * Память Роя — наблюдения завершённых столкновений (PVR-4.2, объём задан
 * `docs/sector-zero-roadmap.md` §3.9).
 *
 * Модуль отвечает на ОДИН вопрос: что против Роя фактически применили и с каким
 * эффектом. Он ничего не решает — выбор адаптации, порог и проект уровня живут в
 * `PVR-4.3`. Разделение не косметическое: наблюдение это ФАКТ симуляции, он обязан
 * быть в `GameState` (инвариант 2), а выбор ответа — тактика, и по ADR
 * `explanations/05-pve-ai-placement.md` тактика в ядре не живёт.
 *
 * **Отсюда же следует, где НЕ лежит окно памяти.** §3.9 задаёт окно профилем сложности
 * (`weak` — последние 4 столкновения, `strong` — весь забег), но сам профиль
 * (`AiProfile` в `prototype/src/ai.ts`) в состояние не попадает и попадать не должен —
 * это ровно та недетерминированная настройка, которую ADR 05 держит вне реплей-контракта.
 * Поэтому ядро копит наблюдения БЕЗ окна, а окно накладывает тот, кто принимает
 * решение, — чистой функцией {@link recalled}. Два матча с одинаковыми боями и разной
 * сложностью дают одинаковое состояние и разные выводы, и это правильно: разной должна
 * быть глубина взгляда, а не история.
 *
 * **Четыре правила честности §3.3 — это тесты кирпича, а не пожелания:**
 *
 * 1. **Только завершённое столкновение с эффектом.** Наблюдение заводит попадание с
 *    `damage > 0` по цели Роя. Пролёт разведчика, радарный контакт и увиденный состав
 *    флота не заводят ничего: этих событий модуль просто не слушает. Вылет, пока он в
 *    воздухе, Рою тоже не сообщает ничего — сообщает контакт.
 * 2. **Повторная телеметрия не считается дважды.** Одно столкновение даёт классу не
 *    больше одного наблюдения, сколько бы попаданий и участников в нём ни было.
 * 3. **Память не наказывает за игру.** Она живёт внутри `GameState` забега и не
 *    переживает его: новая попытка начинает с пустой памяти, а восстановленный забег
 *    возвращает СВОЮ (снимок `PVR-0.3` несёт состояние целиком).
 * 4. **Кошелёк не вход.** Модуль видит только события боя. Покупок, коллекции и
 *    профиля игрока он не читает физически — читать неоткуда.
 *
 * Класс оружия v1 — `strike`, ударный вылет (`shuttle.hit`): это тот класс, который
 * AD-01 обязан контрить, и отвечает ему `pointDefense` из `modules/shuttle.ts`.
 * Ракетного модуля в данных нет вовсе, поэтому §3.9 называет классом механику, которая
 * в движке есть.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameState, PlayerId, SwarmMemory, SwarmObservation } from '../state/gameState';
import type { ModePve } from '../data/schemas';

/** Класс оружия v1: удар челноков и бомбардировщиков. */
export const STRIKE_KIND = 'strike';

/** Секция `pve` режима матча, или `undefined` — матч не PvE и модуль инертен. */
function pveOf(h: HandlerContext): ModePve | undefined {
  const modeId = h.ctx.config?.modeId;
  return modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.pve;
}

/**
 * Место, которое играет Рой. Читается из `state.pve`, если `pveModule` уже завёл его,
 * иначе — по фракции режима, тем же правилом (наименьший id), что и там: память может
 * понадобиться раньше первой волны, и ждать посева было бы молчаливой потерей боёв.
 */
function swarmSeat(state: GameState, cfg: ModePve): PlayerId | undefined {
  if (state.pve) return state.pve.npcPlayerId;
  let found: PlayerId | undefined;
  for (const [id, player] of Object.entries(state.players)) {
    if (player.faction !== cfg.npcFaction) continue;
    if (found === undefined || id < found) found = id;
  }
  return found;
}

/**
 * Зачесть наблюдение. Возвращает `true`, если оно новое.
 *
 * Порядковый номер выдаётся ПО СТОЛКНОВЕНИЮ, а не по наблюдению: два класса, применённые
 * в одном бою, обязаны попасть в одно окно памяти, иначе «последние 4 столкновения»
 * означало бы разное для разного оружия.
 */
function observe(memory: SwarmMemory, kind: string, engagement: string): number | null {
  if (memory.observations.some((o) => o.kind === kind && o.engagement === engagement)) return null;
  const known = memory.observations.find((o) => o.engagement === engagement);
  const ordinal = known?.ordinal ?? ++memory.engagements;
  memory.observations.push({ ordinal, kind, engagement } satisfies SwarmObservation);
  return ordinal;
}

/**
 * Что Рой ПОМНИТ о классе при заданной глубине взгляда — чистая функция, общая ядру и
 * драйверу.
 *
 * `window` в столкновениях; `null` — «весь забег» (профиль операции). Окно отсчитывается
 * от последнего зачтённого столкновения, а не от текущего времени: столкновений может
 * не быть часами, и привязка ко времени означала бы, что память тает сама собой, пока
 * игрок отстраивается.
 */
export function recalled(
  memory: SwarmMemory | undefined,
  kind: string,
  window: number | null,
  known: ReadonlySet<number> | null = null,
): number {
  if (!memory) return 0;
  if (known === null) {
    const from = window === null ? 0 : memory.engagements - window;
    return memory.observations.filter((o) => o.kind === kind && o.ordinal > from).length;
  }
  // Сеть Роя (`docs/swarm-behavior.md`): часть помнит только то, что до неё ДОШЛО, и
  // окно считается по её собственным столкновениям — последние `window` из известных
  // ей, а не из всего журнала забега.
  const mine = [...known].sort((a, b) => a - b);
  const from = window === null || mine.length <= window ? -Infinity : mine[mine.length - window - 1]!;
  return memory.observations.filter((o) => o.kind === kind && known.has(o.ordinal) && o.ordinal > from)
    .length;
}

export const swarmMemoryModule: GameModule = {
  id: 'swarmMemory',
  version: '1.1.0',
  setup(api) {
    // Единственный вход: попадание ударной машины. Не `battle.resolved` — там уже
    // нет состава сторон (флоты освобождены строкой выше emit'а), и класс оружия из
    // него не вывести. Не события разведки — их наличие в этом списке и было бы
    // нарушением правила 1.
    api.on('shuttle.hit', (event, h) => {
      const cfg = pveOf(h);
      if (!cfg) return; // не PvE — модуль инертен, как `pveModule`
      const p = event.payload as {
        strikeId?: unknown;
        targetId?: unknown;
        targetOwner?: unknown;
        damage?: unknown;
      };
      const damage = typeof p.damage === 'number' ? p.damage : 0;
      if (damage <= 0) return; // применение без эффекта наблюдением не является
      const swarm = swarmSeat(h.state, cfg);
      if (swarm === undefined || p.targetOwner !== swarm) return; // задели не Роя
      const strikeId = typeof p.strikeId === 'string' ? p.strikeId : String(p.strikeId ?? '');
      if (strikeId === '') return; // без идентификатора не отличить повтор от нового боя
      const memory: SwarmMemory = h.state.swarmMemory ?? { engagements: 0, observations: [] };
      const ordinal = observe(memory, STRIKE_KIND, `strike:${strikeId}`);
      if (ordinal === null) return; // та же телеметрия
      h.state.swarmMemory = memory;
      // `ordinal` и `witness` — для сети Роя: наблюдение рождается у СВИДЕТЕЛЯ (флот или
      // мир, по которому пришёлся удар) и дальше течёт только по связи.
      h.emit('swarm.observed', {
        owner: swarm,
        kind: STRIKE_KIND,
        engagements: memory.engagements,
        ordinal,
        ...(typeof p.targetId === 'string' ? { witness: p.targetId } : {}),
      });
    });
  },
};

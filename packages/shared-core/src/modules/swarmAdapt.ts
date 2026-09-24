/**
 * Адаптация Роя — от подтверждённого сигнала до усиленного модуля (PVR-4.3, объём
 * задан `docs/sector-zero-roadmap.md` §3.9).
 *
 * Это ВТОРАЯ половина цепочки. Первая — `swarmMemory`: она копит факты. Здесь факты
 * превращаются в проект, проект оплачивается и по истечении срока поднимает уровень
 * конкретного модуля.
 *
 * **Почему решение приходит ДЕЙСТВИЕМ, а не рождается внутри.** Порог «заметил» зависит
 * от глубины памяти, а глубина — это сложность, и она по ADR
 * [`05-pve-ai-placement.md`](../../../../docs/explanations/05-pve-ai-placement.md)
 * живёт вне реплей-контракта. Поэтому «пора» решает драйвер (`pveOrders`) и подаёт
 * `swarm.adapt` на ту же шину, что и приказы игрока, а модуль отвечает только на вопрос
 * «имел ли право»:
 *
 * ```
 * драйвер: recalled(память, класс, окно по сложности) ≥ порог  → подаёт действие
 * ядро:    наблюдал ли ВООБЩЕ · один проект за раз · жив ли орган · хватает ли ресурсов
 * ```
 *
 * Разделение даёт то, чего не даёт ни одна половина по отдельности: сложность меняет
 * МОМЕНТ адаптации, а не её законность. Жульничающий драйвер, подавший действие без
 * единого боя, получает отказ — пол {@link MIN_SIGNAL} проверяется по всему забегу и
 * живёт здесь, а не в тактике.
 *
 * **Потеря органа прекращает незавершённый проект.** Проект привязан к флоту-носителю с
 * выводковой камерой: это он растит форму. Флот погиб — отложенное событие находит
 * пустоту и молча ничего не делает, ресурсы не возвращаются. Так же ведёт себя
 * производство в §3.7: потери это потери, а не скрытый второй ресурс.
 *
 * **Уровень применяется к стекам, а не к игроку.** Носитель — `UnitStack.moduleStars`,
 * та же ось, что у звезды игрока (`SZE-1.1`), и тот же `moduleStarMultiplier`. Разница
 * в источнике: у игрока это снимок меты, неизменный за забег, у Роя — вот этот проект.
 *
 * **Готовый проект — это РЕЦЕПТ, и форма по нему вырастает** (AUD-20, решение владельца
 * 2026-09-24). Модуль-ответ до адаптации не стоит ни на одной матке: Рой не перехватывает
 * шаттлы, пока не научился. По завершении проекта уровень записывается в рецепт Роя
 * (`GameState.swarmRecipes`), а модуль вырастает на каждом стеке Роя, куда его можно
 * поставить (`canEquip`: корпус допускает, гнездо свободно). Новые формы волн рождаются
 * уже по рецепту (`pve.wave.spawned`). Рецепт нужен именно потому, что уровень на стеках
 * смертен: погибли все матки с покровом — знание «как его растить» остаётся, и следующий
 * проект не начинает лестницу заново.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { FleetId, GameState, PlayerId, SwarmAdaptProject, UnitStack } from '../state/gameState';
import type { GameData, ModePve } from '../data/schemas';
import { hoursToMs } from '../action/types';
import { canAfford, payCost } from '../util/treasury';
import { canEquip } from '../util/loadout';
import { recalled } from './swarmMemory';
export type { SwarmAdaptProject };

const DONE = 'swarm.adapt.done';

/** Пол честности: без стольких наблюдений класса за ВЕСЬ забег проект не открыть.
 *  Драйвер со своим окном может ждать дольше — раньше не может (§3.9). */
export const MIN_SIGNAL = 3;

function pveOf(h: HandlerContext): ModePve | undefined {
  const modeId = h.ctx.config?.modeId;
  return modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.pve;
}

/** Место Роя: из `state.pve`, а до посева — по фракции режима (наименьший id). */
function swarmSeat(state: GameState, cfg: ModePve): PlayerId | undefined {
  if (state.pve) return state.pve.npcPlayerId;
  let found: PlayerId | undefined;
  for (const [id, player] of Object.entries(state.players)) {
    if (player.faction !== cfg.npcFaction) continue;
    if (found === undefined || id < found) found = id;
  }
  return found;
}

/** Текущий уровень модуля у Роя — максимум по его стекам. Нет стеков ⇒ 0. */
export function swarmModuleLevel(state: GameState, owner: PlayerId, moduleId: string): number {
  let top = 0;
  for (const id of Object.keys(state.fleets).sort()) {
    const fleet = state.fleets[id];
    if (!fleet || fleet.owner !== owner) continue;
    for (const stack of fleet.units) {
      const level = stack.moduleStars?.[moduleId] ?? 0;
      if (level > top) top = level;
    }
  }
  return top;
}

/**
 * Уровень, который Рой УМЕЕТ растить: рецепт или, для мира, собранного до рецептов,
 * уровень на стеках — что выше. Следующий проект поднимает лестницу отсюда.
 */
export function swarmKnownLevel(state: GameState, owner: PlayerId, moduleId: string): number {
  return Math.max(state.swarmRecipes?.[moduleId] ?? 0, swarmModuleLevel(state, owner, moduleId));
}

/**
 * Вырастить форму на стеке: модуль встаёт, если корпус его допускает и гнездо свободно
 * (тот же `canEquip`, что у верфи игрока, — иначе Рой носил бы то, чего не может нести
 * ни один корабль), и получает уровень рецепта. Уже выращенный уровень не понижается.
 */
function grow(stack: UnitStack, moduleId: string, level: number, data: GameData): boolean {
  const def = data.units[stack.unit];
  if (!def) return false;
  const mods = stack.modules ?? [];
  if (!mods.includes(moduleId)) {
    if (!canEquip(stack.unit, def, mods, moduleId, data).ok) return false;
    stack.modules = [...mods, moduleId];
  }
  if ((stack.moduleStars?.[moduleId] ?? 0) < level) {
    stack.moduleStars = { ...(stack.moduleStars ?? {}), [moduleId]: level };
  }
  return true;
}

/** Вырастить модуль по рецепту на всех стеках флотов `fleetIds`. Возвращает число стеков. */
function growOn(
  state: GameState,
  fleetIds: readonly FleetId[],
  moduleId: string,
  level: number,
  data: GameData,
): number {
  let touched = 0;
  for (const id of fleetIds) {
    const fleet = state.fleets[id];
    if (!fleet) continue;
    for (const stack of fleet.units) if (grow(stack, moduleId, level, data)) touched++;
  }
  return touched;
}

/** Флоты места в стабильном порядке — рост формы не должен зависеть от порядка ключей. */
function fleetsOf(state: GameState, owner: PlayerId): FleetId[] {
  return Object.keys(state.fleets)
    .sort()
    .filter((id) => state.fleets[id]?.owner === owner);
}

/** Флот-орган: несёт камеру вывода, то есть растит формы. */
function isOrgan(state: GameState, fleetId: FleetId, data: GameData): boolean {
  return (
    state.fleets[fleetId]?.units.some((st) =>
      st.modules?.some((id) => data.modules[id]?.brood !== undefined),
    ) ?? false
  );
}

/** Заказ проекта, который драйвер вправе подать прямо сейчас. */
export interface SwarmAdaptOrder {
  moduleId: string;
  fleetId: FleetId;
}

/**
 * Пора ли Рою адаптироваться — правило драйвера, общее обоим хостам (AUD-20).
 *
 * По ADR 05 «пора» решает драйвер: окно памяти — это сложность, и в состояние оно не
 * попадает. Раньше это правило было записано только в серверном оркестраторе, а бот
 * одиночного забега его не знал вовсе, поэтому ни один живой хост Рой не адаптировал.
 * Теперь один ответ на два хоста: проекта нет, орган жив, следующий шаг лестницы есть,
 * класс наблюдён `MIN_SIGNAL` раз в пределах окна и запаса хватает. Последнее ядро
 * проверит и само, но драйвер, заказывающий неоплатное каждый тик, только сыпал бы
 * отказами. Модули и флоты перебираются по отсортированным id: два хоста обязаны
 * выбрать один и тот же ответ на одну и ту же память.
 */
export function swarmAdaptDue(
  state: GameState,
  data: GameData,
  npc: PlayerId,
  window: number | null,
): SwarmAdaptOrder | null {
  if (state.swarmAdapt) return null; // проект одновременно один
  const host = fleetsOf(state, npc).find((id) => isOrgan(state, id, data));
  if (host === undefined) return null;
  const purse = state.players[npc]?.resources ?? {};
  for (const moduleId of Object.keys(data.modules).sort()) {
    const ladder = data.modules[moduleId]?.adaptation;
    if (!ladder) continue;
    const step = ladder.levels[swarmKnownLevel(state, npc, moduleId)];
    if (!step) continue; // лестница пройдена
    if (recalled(state.swarmMemory, ladder.signal, window) < MIN_SIGNAL) continue;
    if (!canAfford(purse, step.cost)) continue;
    return { moduleId, fleetId: host };
  }
  return null;
}

/**
 * Окно памяти по сложности забега (§3.9): слабый Рой помнит последние `4` завершённых
 * столкновения, сильный — весь забег. Профиль — параметр драйвера, а не поле состояния
 * (ADR 05), поэтому таблица живёт рядом с правилом, которое её читает.
 */
export const SWARM_MEMORY_WINDOW: Readonly<Record<'weak' | 'strong', number | null>> = {
  weak: 4,
  strong: null,
};

export const swarmAdaptModule: GameModule = {
  id: 'swarmAdapt',
  version: '1.1.0',
  setup(api) {
    api.onAction('swarm.adapt', (action, h) => {
      const cfg = pveOf(h);
      if (!cfg) return h.reject('E_NOT_PVE');
      const swarm = swarmSeat(h.state, cfg);
      // Действие принадлежит Рою и только ему: человеческой фракции запрещён прямой
      // заказ его форм и уровней (граница из §3 — «лор согласован», PR #1113).
      if (swarm === undefined || action.playerId !== swarm) return h.reject('E_NOT_SWARM');
      if (h.state.swarmAdapt) return h.reject('E_ADAPT_BUSY');

      const p = action.payload as { moduleId?: unknown; fleetId?: unknown };
      if (typeof p?.moduleId !== 'string' || typeof p?.fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const def = h.ctx.data.modules[p.moduleId];
      const ladder = def?.adaptation;
      if (!ladder) return h.reject('E_NO_ADAPTATION');

      // Пол честности: класс обязан быть НАБЛЮДЁН, и не единожды. Окно здесь самое
      // широкое (весь забег) намеренно — узкое окно это дело сложности, а не права.
      if (recalled(h.state.swarmMemory, ladder.signal, null) < MIN_SIGNAL) {
        return h.reject('E_NO_SIGNAL');
      }

      const level = swarmKnownLevel(h.state, swarm, p.moduleId) + 1;
      const step = ladder.levels[level - 1];
      if (!step) return h.reject('E_ADAPT_MAXED'); // длина лестницы и есть потолок

      // Орган: флот Роя с камерой вывода. Отсутствующий и чужой — один код (A06).
      const fleet = h.state.fleets[p.fleetId];
      if (!fleet || fleet.owner !== swarm) return h.reject('E_NO_ORGAN');
      const hasOrgan = fleet.units.some((st) =>
        st.modules?.some((id) => h.ctx.data.modules[id]?.brood !== undefined),
      );
      if (!hasOrgan) return h.reject('E_NO_ORGAN');

      const player = h.state.players[swarm];
      if (!player) return h.reject('E_NO_PLAYER');
      if (!canAfford(player.resources, step.cost)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, step.cost);

      const dueAt = h.ctx.now + hoursToMs(h.ctx, step.hours);
      h.state.swarmAdapt = { moduleId: p.moduleId, level, fleetId: p.fleetId, dueAt };
      h.schedule(dueAt, DONE, { moduleId: p.moduleId, level, fleetId: p.fleetId });
      h.emit('swarm.adapt.started', { owner: swarm, moduleId: p.moduleId, level, dueAt });
    });

    api.on(DONE, (event, h) => {
      const project = h.state.swarmAdapt;
      if (!project) return; // проект уже снят — гибелью носителя либо концом матча
      const p = event.payload as { moduleId: string; level: number; fleetId: string };
      if (p.moduleId !== project.moduleId || p.level !== project.level) return; // чужое эхо
      delete h.state.swarmAdapt;
      const cfg = pveOf(h);
      const swarm = cfg ? swarmSeat(h.state, cfg) : undefined;
      if (swarm === undefined) return;
      // Носитель мог погибнуть между стартом и сроком: тогда выращивать некому, и
      // отложенное событие не имеет права выпустить уровень «из пустоты» (§3.6).
      // Смотрится носитель ПРОЕКТА, а не событие: влитый в другой флот орган живёт
      // дальше под новым id (`fleet.merged` ниже), и проект едет вместе с ним.
      if (!h.state.fleets[project.fleetId]) return;
      const recipes = (h.state.swarmRecipes ??= {});
      recipes[p.moduleId] = Math.max(recipes[p.moduleId] ?? 0, p.level);
      const touched = growOn(h.state, fleetsOf(h.state, swarm), p.moduleId, p.level, h.ctx.data);
      h.emit('swarm.adapt.done', { owner: swarm, moduleId: p.moduleId, level: p.level, touched });
    });

    // Новая форма рождается по рецепту: волна, вышедшая после адаптации, уже несёт ответ.
    // Слушается событие волны, а не импортируется модуль волн — модули говорят шиной.
    api.on('pve.wave.spawned', (event, h) => {
      const recipes = h.state.swarmRecipes;
      if (!recipes) return;
      const p = event.payload as { fleetId?: unknown };
      if (typeof p.fleetId !== 'string') return;
      for (const moduleId of Object.keys(recipes).sort()) {
        const level = recipes[moduleId] ?? 0;
        if (level > 0) growOn(h.state, [p.fleetId], moduleId, level, h.ctx.data);
      }
    });

    // Орган влит в другой флот — матки живы, просто летят под другим флагом. Без этого
    // бот, собравший флоты в кулак, молча хоронил бы оплаченный проект: прогон MC-01
    // поймал ровно это — носитель слился с волной, и срок нашёл пустоту.
    api.on('fleet.merged', (event, h) => {
      const project = h.state.swarmAdapt;
      const p = event.payload as { from?: unknown; into?: unknown };
      if (!project || project.fleetId !== p.from || typeof p.into !== 'string') return;
      project.fleetId = p.into;
    });

    // Гибель носителя прекращает проект СРАЗУ, не дожидаясь срока: иначе журнал
    // показывал бы игроку «идёт выращивание» у флота, которого больше нет.
    api.on('fleet.destroyed', (event, h) => {
      const p = event.payload as { fleetId?: unknown; owner?: unknown };
      if (h.state.swarmAdapt && h.state.swarmAdapt.fleetId === p.fleetId) {
        const lost = h.state.swarmAdapt;
        delete h.state.swarmAdapt;
        // `owner` не украшение: контракт тумана требует, чтобы у события был ключ,
        // по которому комната решает, кому его показывать (`eventFogContract`).
        const owner = typeof p.owner === 'string' ? p.owner : undefined;
        h.emit('swarm.adapt.lost', { owner, moduleId: lost.moduleId, level: lost.level });
      }
    });
  },
};

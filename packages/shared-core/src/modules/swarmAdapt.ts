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
 *
 * **Сеть Роя делит всё это по частям** (`docs/swarm-behavior.md`, решения владельца
 * 2026-09-24). Когда сеть заведена (`state.swarmNet`), орган знает только то, что дошло
 * до его части: пол сигнала, окно и уровень считаются по знанию части
 * (`knowledgeOf`), проектов — по одному на часть, форма по готовому проекту вырастает на
 * флотах этой части, а волна рождается по рецептам своей части. Рецепт дальше течёт по
 * связи: восстановленная связь даёт его НОВЫМ формам другой части, построенные остаются
 * как есть. Без сети всё как прежде — знание общее, проект один.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { FleetId, GameState, PlayerId, SwarmAdaptProject, UnitStack } from '../state/gameState';
import type { GameData, ModePve } from '../data/schemas';
import { hoursToMs } from '../action/types';
import { canAfford, payCost } from '../util/treasury';
import { canEquip } from '../util/loadout';
import { fleetHolder, knowledgeOf, swarmNet, type SwarmKnown, type SwarmNetView } from '../util/swarmNet';
import { recalled } from './swarmMemory';
export type { SwarmAdaptProject };

/** Отложенный срок проекта. Своё имя, а не `swarm.adapt.done`: объявление о готовности
 *  носит то же имя, и один обработчик ловил бы оба. */
const RIPE = 'swarm.adapt.ripe';

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

/** Карта сети в момент `now`, или `null`, если сети нет. */
function netView(state: GameState, data: GameData, owner: PlayerId, now: number): SwarmNetView | null {
  return state.swarmNet ? swarmNet(state, data, owner, now) : null;
}

/** Часть флота: ключ его части сети; без сети — одна часть на весь Рой. */
function partOfFleet(view: SwarmNetView | null, fleetId: FleetId): string {
  if (!view) return '*';
  const holder = fleetHolder(fleetId);
  return view.partOf.get(holder) ?? holder;
}

/** Флоты места в той же части, что `fleetId` (без сети — все флоты места). */
function fleetsInPart(
  state: GameState,
  owner: PlayerId,
  view: SwarmNetView | null,
  fleetId: FleetId,
): FleetId[] {
  const part = partOfFleet(view, fleetId);
  return fleetsOf(state, owner).filter((id) => partOfFleet(view, id) === part);
}

/** Уровень, который часть умеет растить: рецепт части; без сети — {@link swarmKnownLevel}. */
function partLevel(state: GameState, owner: PlayerId, moduleId: string, know: SwarmKnown): number {
  return know.known === null
    ? swarmKnownLevel(state, owner, moduleId)
    : (know.recipes[moduleId] ?? 0);
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
 * Теперь один ответ на два хоста: в части нет проекта, орган жив, следующий шаг лестницы
 * есть, класс наблюдён `MIN_SIGNAL` раз в пределах окна и запаса хватает. Последнее ядро
 * проверит и само, но драйвер, заказывающий неоплатное каждый тик, только сыпал бы
 * отказами. Заказов — по одному на часть сети (без сети — один); запас общий, поэтому
 * каждый следующий заказ меряется по остатку после предыдущих. Модули и флоты
 * перебираются по отсортированным id: два хоста обязаны выбрать один и тот же ответ на
 * одну и ту же память.
 */
export function swarmAdaptDue(
  state: GameState,
  data: GameData,
  npc: PlayerId,
  window: number | null,
): SwarmAdaptOrder[] {
  const view = netView(state, data, npc, state.time);
  const busy = new Set((state.swarmAdapts ?? []).map((p) => partOfFleet(view, p.fleetId)));
  const purse = { ...(state.players[npc]?.resources ?? {}) };
  const out: SwarmAdaptOrder[] = [];
  // Проект гибнет вместе с органом, поэтому орган берётся самый безопасный: не в бою и
  // дальше всех от миров игроков. Волна у порога игрока — последний выбор.
  const theirs = Object.values(state.planets).filter(
    (p) => p.owner !== null && p.owner !== npc && !state.players[p.owner]?.npc,
  );
  const danger = (id: FleetId): number => {
    const f = state.fleets[id]!;
    const at = f.location ? state.planets[f.location]?.position : undefined;
    if (f.battleId || !at || theirs.length === 0) return f.battleId ? Infinity : 0;
    return -Math.min(...theirs.map((t) => Math.sqrt((t.position.x - at.x) * (t.position.x - at.x) + (t.position.y - at.y) * (t.position.y - at.y))));
  };
  const organs = fleetsOf(state, npc)
    .filter((id) => isOrgan(state, id, data))
    .sort((a, b) => danger(a) - danger(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const organ of organs) {
    const part = partOfFleet(view, organ);
    if (busy.has(part)) continue; // в части уже растёт проект
    const know = knowledgeOf(state, data, npc, fleetHolder(organ), state.time, view ?? undefined);
    for (const moduleId of Object.keys(data.modules).sort()) {
      const ladder = data.modules[moduleId]?.adaptation;
      if (!ladder) continue;
      const step = ladder.levels[partLevel(state, npc, moduleId, know)];
      if (!step) continue; // лестница пройдена
      if (recalled(state.swarmMemory, ladder.signal, window, know.known) < MIN_SIGNAL) continue;
      if (!canAfford(purse, step.cost)) continue;
      payCost(purse, step.cost);
      out.push({ moduleId, fleetId: organ });
      busy.add(part);
      break;
    }
  }
  return out;
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
  version: '2.0.0',
  setup(api) {
    api.onAction('swarm.adapt', (action, h) => {
      const cfg = pveOf(h);
      if (!cfg) return h.reject('E_NOT_PVE');
      const swarm = swarmSeat(h.state, cfg);
      // Действие принадлежит Рою и только ему: человеческой фракции запрещён прямой
      // заказ его форм и уровней (граница из §3 — «лор согласован», PR #1113).
      if (swarm === undefined || action.playerId !== swarm) return h.reject('E_NOT_SWARM');

      const p = action.payload as { moduleId?: unknown; fleetId?: unknown };
      if (typeof p?.moduleId !== 'string' || typeof p?.fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const def = h.ctx.data.modules[p.moduleId];
      const ladder = def?.adaptation;
      if (!ladder) return h.reject('E_NO_ADAPTATION');

      // Орган: флот Роя с камерой вывода. Отсутствующий и чужой — один код (A06).
      const fleet = h.state.fleets[p.fleetId];
      if (!fleet || fleet.owner !== swarm) return h.reject('E_NO_ORGAN');
      if (!isOrgan(h.state, p.fleetId, h.ctx.data)) return h.reject('E_NO_ORGAN');

      // Проект — по одному на часть сети; без сети — один на весь Рой.
      const view = netView(h.state, h.ctx.data, swarm, h.ctx.now);
      const part = partOfFleet(view, p.fleetId);
      if ((h.state.swarmAdapts ?? []).some((q) => partOfFleet(view, q.fleetId) === part)) {
        return h.reject('E_ADAPT_BUSY');
      }

      // Пол честности: класс обязан быть НАБЛЮДЁН, и не единожды. Окно здесь самое
      // широкое (всё, что знает часть органа) намеренно — узкое окно это дело сложности,
      // а не права. Сведения, не дошедшие до части, права не дают.
      const know = knowledgeOf(
        h.state,
        h.ctx.data,
        swarm,
        fleetHolder(p.fleetId),
        h.ctx.now,
        view ?? undefined,
      );
      if (recalled(h.state.swarmMemory, ladder.signal, null, know.known) < MIN_SIGNAL) {
        return h.reject('E_NO_SIGNAL');
      }

      const level = partLevel(h.state, swarm, p.moduleId, know) + 1;
      const step = ladder.levels[level - 1];
      if (!step) return h.reject('E_ADAPT_MAXED'); // длина лестницы и есть потолок

      const player = h.state.players[swarm];
      if (!player) return h.reject('E_NO_PLAYER');
      if (!canAfford(player.resources, step.cost)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, step.cost);

      const dueAt = h.ctx.now + hoursToMs(h.ctx, step.hours);
      const id = `${p.fleetId}:${p.moduleId}:${level}:${h.ctx.now}`;
      (h.state.swarmAdapts ??= []).push({ id, moduleId: p.moduleId, level, fleetId: p.fleetId, dueAt });
      h.schedule(dueAt, RIPE, { id });
      h.emit('swarm.adapt.started', { owner: swarm, moduleId: p.moduleId, level, dueAt });
    });

    api.on(RIPE, (event, h) => {
      const id = (event.payload as { id?: unknown }).id;
      const projects = h.state.swarmAdapts ?? [];
      const project = projects.find((q) => q.id === id);
      if (!project) return; // проект уже снят — гибелью носителя либо концом матча
      dropProject(h, project.id);
      const cfg = pveOf(h);
      const swarm = cfg ? swarmSeat(h.state, cfg) : undefined;
      if (swarm === undefined) return;
      // Носитель мог погибнуть между стартом и сроком: тогда выращивать некому, и
      // отложенное событие не имеет права выпустить уровень «из пустоты» (§3.6).
      // Смотрится носитель ПРОЕКТА, а не событие: влитый в другой флот орган живёт
      // дальше под новым id (`fleet.merged` ниже), и проект едет вместе с ним.
      if (!h.state.fleets[project.fleetId]) return;
      const recipes = (h.state.swarmRecipes ??= {});
      recipes[project.moduleId] = Math.max(recipes[project.moduleId] ?? 0, project.level);
      // Форма вырастает в ЧАСТИ органа: отрезанные флоты получат её только новыми формами,
      // когда рецепт дойдёт до них по связи.
      const view = netView(h.state, h.ctx.data, swarm, h.ctx.now);
      const touched = growOn(
        h.state,
        fleetsInPart(h.state, swarm, view, project.fleetId),
        project.moduleId,
        project.level,
        h.ctx.data,
      );
      h.emit('swarm.adapt.done', {
        owner: swarm,
        moduleId: project.moduleId,
        level: project.level,
        touched,
        fleetId: project.fleetId,
      });
    });

    // Новая форма рождается по рецепту своей части: волна, вышедшая после адаптации,
    // уже несёт ответ. Слушается событие волны, а не импортируется модуль волн — модули
    // говорят шиной.
    api.on('pve.wave.spawned', (event, h) => {
      const p = event.payload as { fleetId?: unknown; owner?: unknown };
      if (typeof p.fleetId !== 'string' || typeof p.owner !== 'string') return;
      const know = knowledgeOf(h.state, h.ctx.data, p.owner, fleetHolder(p.fleetId), h.ctx.now);
      for (const moduleId of Object.keys(know.recipes).sort()) {
        const level = know.recipes[moduleId] ?? 0;
        if (level > 0) growOn(h.state, [p.fleetId], moduleId, level, h.ctx.data);
      }
    });

    // Орган влит в другой флот — матки живы, просто летят под другим флагом. Без этого
    // бот, собравший флоты в кулак, молча хоронил бы оплаченный проект: прогон MC-01
    // поймал ровно это — носитель слился с волной, и срок нашёл пустоту.
    api.on('fleet.merged', (event, h) => {
      const p = event.payload as { from?: unknown; into?: unknown };
      if (typeof p.into !== 'string') return;
      for (const project of h.state.swarmAdapts ?? []) {
        if (project.fleetId === p.from) project.fleetId = p.into;
      }
    });

    // Гибель носителя прекращает проект СРАЗУ, не дожидаясь срока: иначе журнал
    // показывал бы игроку «идёт выращивание» у флота, которого больше нет.
    api.on('fleet.destroyed', (event, h) => {
      const p = event.payload as { fleetId?: unknown; owner?: unknown };
      for (const lost of [...(h.state.swarmAdapts ?? [])]) {
        if (lost.fleetId !== p.fleetId) continue;
        dropProject(h, lost.id);
        // `owner` не украшение: контракт тумана требует, чтобы у события был ключ,
        // по которому комната решает, кому его показывать (`eventFogContract`).
        const owner = typeof p.owner === 'string' ? p.owner : undefined;
        h.emit('swarm.adapt.lost', { owner, moduleId: lost.moduleId, level: lost.level });
      }
    });
  },
};

/** Снять проект по id; опустевший список исчезает, а не висит пустым в снапшоте. */
function dropProject(h: HandlerContext, id: string): void {
  const rest = (h.state.swarmAdapts ?? []).filter((q) => q.id !== id);
  if (rest.length > 0) h.state.swarmAdapts = rest;
  else delete h.state.swarmAdapts;
}

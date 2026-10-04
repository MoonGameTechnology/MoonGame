/**
 * Главная цепочка главы. Это не дополнительные задачи пула: цепочка решает исход главы,
 * поэтому показывается отдельно от них и ничего не платит.
 *
 * Чистое решение для панели задач, чипа и меток: шаги, какой из них текущий, куда вести
 * камеру и сколько сделано. Мир без сценария (главы I–III, партия) цепочки не имеет — `null`.
 *
 * - **Глава IV** (`docs/sector-zero-map-concepts.md` §6.1, кирпич PVR-7.5): связь с союзником →
 *   архив → извлечение накопителя → доставка в зону вывода.
 * - **Глава VI** (§8.8, кирпич PVR-8.5) — мир с контрактом операции: найти доки → вывести людей
 *   → подавить очаги → разгромить главные силы. Три последних шага — результаты контракта, и
 *   счёт у них тот же, по которому судит ядро (`operationStatus`): панель не напишет «3/3»,
 *   пока ядро победы не видит. Порядок результатов — подсказка: их берут в любом порядке.
 *   Связь шагом не служит — союзник на связи с первой минуты (§8.3).
 * - **Глава V** (§7.4–7.5, кирпич PVR-9.7) — тот же контракт, но из одних очагов: найти
 *   связующее звено сети Роя → подавить очаги. Звено — направляющий шаг: знакомит с сетью,
 *   но победу не запирает. Результата, которого контракт не объявил, в цепочке нет.
 */
import type { GameData, GameState, PlayerId } from '../packages/shared-core/src/index';
import {
  HAVEN_TRAIT,
  RELAY_POST_TRAIT,
  REFUGE_TRAIT,
  contactedAllies,
  getStance,
  operationStatus,
} from '../packages/shared-core/src/index';

export type ChapterStepId =
  | 'contact'
  | 'archive'
  | 'extract'
  | 'deliver'
  | 'link'
  | 'docks'
  | 'evacuate'
  | 'production'
  | 'forces';

/** Признак провинции — ближайшее соединение сети Роя, к которому ведёт шаг «звено» (глава V). */
export const NET_LEAD_TRAIT = 'net_lead';

export interface ChapterStep {
  id: ChapterStepId;
  /** Ключ подписи шага: `chain.<id>`. */
  key: string;
  done: boolean;
  /** Текущий шаг — первый невыполненный. */
  active: boolean;
  /** Куда вести камеру: провинция цели шага. */
  target?: string;
  /** Доля работы (извлечение), 0…1. */
  progress?: number;
  /** Счёт результата операции: сколько сделано из нужного (главы V и VI). */
  count?: { done: number; total: number };
  /** Правило, которое игрок видит до риска (§8.8): довести `need` из `of` возможных. */
  rule?: { need: number; of: number };
}

type Step = Omit<ChapterStep, 'active'>;

/** Место встречи этого мира (первое по id — карта объявляет одно). */
export function rendezvousOf(state: GameState): { at: string; ally: PlayerId } | null {
  for (const id of Object.keys(state.planets).sort()) {
    const ally = state.planets[id]!.rendezvous;
    if (ally) return { at: id, ally };
  }
  return null;
}

/**
 * Назначенный союзник главы, с которым игрок на связи, — или `null`: встречи ещё не было
 * или сценария нет. Случайный ИИ в союзе назначенным не считается (§7.5).
 */
export function linkedAlly(state: GameState, me: PlayerId): PlayerId | null {
  const meet = rendezvousOf(state);
  if (!meet) return null;
  return contactedAllies(state, me).includes(meet.ally) ? meet.ally : null;
}

/** Первая по id провинция с признаком; с `owner` — только его. */
function siteWith(state: GameState, trait: string, owner?: PlayerId): string | undefined {
  return Object.keys(state.planets)
    .sort()
    .find((id) => {
      const p = state.planets[id]!;
      return p.traits.includes(trait) && (owner === undefined || p.owner === owner);
    });
}

/** Глава IV: связь → архив → извлечение → вывод. `null` — сценария нет. */
function scenarioSteps(state: GameState, me: PlayerId, needMs: number): Step[] | null {
  const meet = rendezvousOf(state);
  const ex = state.extraction;
  if (!meet && !ex) return null;
  const steps: Step[] = [];
  if (meet) {
    steps.push({
      id: 'contact',
      key: 'chain.contact',
      done: contactedAllies(state, me).includes(meet.ally),
      target: meet.at,
    });
  }
  if (ex) {
    const owner = state.planets[ex.vault]?.owner ?? null;
    const cleared =
      ex.carrier !== undefined ||
      owner === null ||
      owner === me ||
      getStance(state, me, owner) === 'alliance';
    steps.push({ id: 'archive', key: 'chain.archive', done: cleared, target: ex.vault });
    const carried = ex.carrier !== undefined;
    steps.push({
      id: 'extract',
      key: 'chain.extract',
      done: carried,
      target: ex.vault,
      progress: carried ? 1 : needMs > 0 ? Math.min(1, ex.doneMs / needMs) : 0,
    });
    const carrierAt = ex.carrier ? (state.fleets[ex.carrier]?.location ?? undefined) : undefined;
    steps.push({
      id: 'deliver',
      key: 'chain.deliver',
      done: ex.deliveredAt !== undefined,
      // Пока носителя нет — зона вывода; есть — сам носитель (где он сейчас стоит).
      target: carrierAt ?? ex.zone,
    });
  }
  return steps;
}

/**
 * Звено сети найдено (глава V, §7.4): игрок хоть раз опознал флот Роя с большим
 * ретранслятором — своим зрением или зрением союзника, обзор у них общий. Знакомство
 * историческое: `swarmIntel` помнит контакт и после ухода разведчика, но устаревшие сведения
 * текущими не объявляет.
 */
function relaySighted(state: GameState, me: PlayerId, data: GameData): boolean {
  return Object.values(state.swarmIntel?.[me] ?? {}).some((contact) =>
    contact.units.some((u) => data.units[u.unit]?.traits.includes(RELAY_POST_TRAIT)),
  );
}

/** Контракт операции: звено сети (глава V), доки (глава VI) и объявленные результаты.
 *  `null` — штурм ещё не начат (врага не знаем). */
function operationSteps(state: GameState, me: PlayerId, data: GameData): Step[] | null {
  const op = state.operation;
  const status = operationStatus(state, data);
  if (!op || !status) return null;
  const steps: Step[] = [];
  const lead = siteWith(state, NET_LEAD_TRAIT);
  if (lead !== undefined)
    steps.push({
      id: 'link',
      key: 'chain.link',
      done: relaySighted(state, me, data),
      target: lead,
    });
  const docks = siteWith(state, REFUGE_TRAIT);
  const found = docks !== undefined && (state.missionFacts?.found?.[me] ?? []).includes(docks);
  if (docks !== undefined)
    steps.push({ id: 'docks', key: 'chain.docks', done: found, target: docks });
  // Люди ждут в доках, пока за ними не пришли; дальше их путь — к своему убежищу. До сведений
  // о доках цели у эвакуации нет: метка не открывает место раньше эпизода (§8.4).
  const waiting =
    docks !== undefined && (state.planets[docks]!.awaitingFleets ?? []).some((f) => f.owner === me);
  const evacTo =
    docks !== undefined && !found ? undefined : waiting ? docks : siteWith(state, HAVEN_TRAIT, me);
  // Эвакуации в контракте нет (глава V) — нет и шага.
  if (status.need > 0)
    steps.push({
      id: 'evacuate',
      key: 'chain.evacuate',
      done: status.delivered >= status.need,
      count: { done: Math.min(status.delivered, status.need), total: status.need },
      rule: { need: status.need, of: status.possible },
      ...(evacTo !== undefined ? { target: evacTo } : {}),
    });
  steps.push({
    id: 'production',
    key: 'chain.production',
    done: status.held.length === 0,
    count: { done: op.production.length - status.held.length, total: op.production.length },
    ...(status.held[0] !== undefined ? { target: status.held[0] } : {}),
  });
  if (status.forces > 0)
    steps.push({
      id: 'forces',
      key: 'chain.forces',
      done: status.broken.length === status.forces,
      count: { done: status.broken.length, total: status.forces },
    });
  return steps;
}

/**
 * Цепочка главы глазами игрока `me`. `needMs` — сколько работы нужно на извлечение в мс
 * матча (`extractionNeedMs` ядра: часы карты под темп): решение не знает темпа само.
 * `data` — для счёта контракта операции (беженцы и корпус соединений).
 */
export function chapterChain(
  state: GameState,
  me: PlayerId,
  needMs: number,
  data: GameData,
): ChapterStep[] | null {
  const steps = state.operation
    ? operationSteps(state, me, data)
    : scenarioSteps(state, me, needMs);
  if (!steps) return null;
  const firstOpen = steps.findIndex((st) => !st.done);
  return steps.map((st, i) => ({ ...st, active: i === firstOpen }));
}

/**
 * Какими флотами игрок может начать извлечение прямо сейчас: свои, стоят у архива, не в
 * пути и не в бою, с живым кораблём. Правила того же порядка, что у ядра
 * (`extraction.start`), — окончательный ответ даёт оно, здесь только кандидаты для кнопки.
 */
export function extractionCandidates(state: GameState, me: PlayerId): string[] {
  const ex = state.extraction;
  if (!ex || ex.carrier !== undefined || ex.deliveredAt !== undefined || ex.lostAt !== undefined)
    return [];
  return Object.values(state.fleets)
    .filter((f) => f.owner === me && f.location === ex.vault && !f.movement && !f.battleId)
    .filter((f) => f.units.some((u) => u.count > 0))
    .map((f) => f.id)
    .sort();
}

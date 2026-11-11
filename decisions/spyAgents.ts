/**
 * Сеть шпионов (SPY-6, решение владельца 2026-10-21: «ограничение по агентам, пока 3»;
 * SPY-23: именные шпионы со своим местом на карте). Само правило — сколько шпионов, где
 * каждый и чем занят — в ядре (`espionageModule`, `state.spies`); здесь только что
 * показать игроку в сводке «свободно N из M».
 *
 * 1. **Свободен = отдыхает в столице или ждёт приказа на мире.** Остальные (в пути, на
 *    задании, возвращаются, вербуются, залегли на дно) — в списке занятых.
 * 2. **Ближайший освободившийся — первым.** Список занятых идёт по сроку, чтобы сверху
 *    стояло то, чего ждать меньше всего; без срока (пост, «на дне») — в конце.
 */
import type { Spy, SpyOp } from '../packages/shared-core/src/index';

/** Занятый шпион в сводке: до какого мига, погиб ли (идёт замена), куда ушёл. */
export interface AgentAway {
  /** Когда освободится (мс мира); `Number.MAX_SAFE_INTEGER` — без срока. */
  until: number;
  lost?: true;
  op?: SpyOp;
  planetId?: string;
  posted?: true;
}

/** Что показать про сеть шпионов. */
export interface SpyAgents {
  /** Сколько шпионов можно отправить прямо сейчас. */
  free: number;
  /** Размер сети. */
  total: number;
  /** Занятые шпионы, ближайший освободившийся первым. */
  away: AgentAway[];
}

const NO_END = Number.MAX_SAFE_INTEGER;

/** Правила 1–2 над реестром шпионов игрока (`spyRoster` ядра). */
export function spyAgents(roster: readonly Spy[]): SpyAgents {
  const away: AgentAway[] = [];
  for (const s of roster) {
    if (s.state === 'rest' || s.state === 'wait') continue;
    if (s.state === 'recruit') away.push({ until: s.arrivesAt ?? NO_END, lost: true });
    else if (s.state === 'travel' || s.state === 'work')
      away.push({
        until: s.posted ? NO_END : (s.arrivesAt ?? NO_END),
        ...(s.op ? { op: s.op } : {}),
        planetId: s.location,
        ...(s.posted ? { posted: true as const } : {}),
      });
    else away.push({ until: s.arrivesAt ?? NO_END });
  }
  away.sort((a, b) => a.until - b.until);
  return { free: roster.length - away.length, total: roster.length, away };
}

// КАКУЮ ТЕХНОЛОГИЮ ИЗУЧИТЬ, ЧТОБЫ ОТКРЫТЬ ЮНИТ ИЛИ ЗДАНИЕ — и в каком она сейчас состоянии.
//
// ЗАЧЕМ. Запертая технологией строка окна стройки говорила безымянное «🔒 нужна технология»:
// ядро отбивает приказ кодом `E_TECH_LOCKED` без имени, и игрок шёл искать, ЧТО изучить, по
// всем веткам дерева. У космической крепости этот путь уже был (FORT-0.2: «Сначала изучите
// технологию «X»» и кнопка в технологии), у юнитов и зданий — нет (сообщение владельца
// 2026-11-06: «чтоб предлагало изучить технологию, как с космической крепостью, только с
// юнитами и зданиями»).
//
// ПРАВИЛО НЕ КОПИРУЕТСЯ. Что открывает юнит или здание, отвечает список ядра
// (`technologiesUnlocking`, тот же, которым решает хук `construction.requirement`), правилом
// «любая из»: изучена хоть одна — ворот нет. Из списка уходят технологии, которых в этом
// матче нет (`techInMatch`: режим может убрать узел из дерева), — вести игрока в досье,
// которого окно технологий не покажет, значило бы кнопку, которая ничего не открывает.
// Показывать ли предложение вообще, решает НЕ этот модуль, а отказ ядра на настоящий приказ:
// предложение рисуют только на `E_TECH_LOCKED`, а здесь лишь называют лекарство.
//
// Лежит в `/decisions` по правилу CLAUDE.md: окно стройки рисуют оба клиента.
import { technologiesUnlocking, techInMatch } from '../packages/shared-core/src/index';
import type { GameData, GameState } from '../packages/shared-core/src/index';

/** Где сейчас предлагаемая технология: не начата, ждёт в очереди исследований, уже идёт. */
export type TechNeedStatus = 'locked' | 'queued' | 'running';

export interface TechNeed {
  /** Технологии матча, любая из которых открывает, — чтобы назвать их игроку. */
  needs: string[];
  /** Какую из них открыть по кнопке: идущую, иначе стоящую в очереди, иначе первую. */
  offer: string;
  status: TechNeedStatus;
  /** Место `offer` в очереди исследований, с единицы; 0 — не в очереди. */
  queuePos: number;
}

/**
 * Что изучить, чтобы игрок `me` мог заказать `kind`/`id`. `null` — технологических ворот у
 * него нет: их нет в данных, одна из открывающих уже изучена или ни одной нет в этом матче.
 *
 * Предлагается та, что уже в работе: если игрок поставил тему изучаться, кнопка должна
 * привести к ней, а не к соседней, которую он не выбирал.
 */
export function techNeed(
  state: Pick<GameState, 'players' | 'techRules'>,
  me: string,
  data: GameData,
  kind: 'unit' | 'building',
  id: string,
): TechNeed | null {
  const locks = technologiesUnlocking(data, kind, id, state);
  if (locks.length === 0) return null;
  const tech = state.players[me]?.technologies;
  if (locks.some((t) => tech?.completed.includes(t))) return null;
  const needs = locks.filter((t) => techInMatch(state, t, data));
  if (needs.length === 0) return null;
  const queue = tech?.queue ?? [];
  // Матч, сохранённый до параллельных слотов, держит `active` одним объектом, а не списком
  // (его переносит ядро на первом же приказе) — читаем обе формы, как окно технологий.
  const raw: unknown = tech?.active;
  const active = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ technology: string }>;
  const running = needs.find((t) => active.some((a) => a.technology === t));
  if (running) return { needs, offer: running, status: 'running', queuePos: 0 };
  const queued = needs.find((t) => queue.includes(t));
  if (queued) return { needs, offer: queued, status: 'queued', queuePos: queue.indexOf(queued) + 1 };
  return { needs, offer: needs[0]!, status: 'locked', queuePos: 0 };
}

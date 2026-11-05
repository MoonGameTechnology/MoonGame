/** НАУКА В ХОДЕ БОТА (SLIM-3): какой узел исследовать и на что копить (копилка доктрины). */
import {
  BASE_RESEARCH_SLOTS,
  conditionMet,
  matchCost,
  techInMatch,
  technologyLock,
} from '../../../packages/shared-core/src/index';
import { researchTech } from '../../../decisions/actions';
import { doctrineRanks } from '../botDoctrine';
import { data } from '../gameData';
import type { HomeTurn } from './home';
import { ORDER_RESERVE } from './rules';
import type { AiTurn } from './turn';

/** Сколько часов дохода бот готов копить на узел своей ветки (копилка доктрины). Полсуток
 *  оказались много: космос отдавал стройку узлам и проигрывал середину партии (`selfplay
 *  200` sp/alt: побед 45/41%). Без копилки вершину ветки брали 8–23% мест, с 4 часами —
 *  15–56%, а побед у космоса 48/40%. */
const DOCTRINE_SAVE_HOURS = 4;

export function researchOrders(bot: AiTurn, home: HomeTurn): void {
  const { state, ai, out, pad, swarmInhabitant, skilled, doctrine } = bot;
  const { pl, flow } = home;
  // ТОЛЬКО СИЛЬНЫЙ (AI-BAL-1.1): технологии исследует сильный профиль, слабый — нет.
  // Слабый и есть «прежний простой соперник»; сильного игрок выбирает сам в соло
  // (AIDIFF-1), и его же берёт прогон баланса — ему нужна работающая ветка эффектов.
  //
  // Технологии: игровой бот не исследует НИ ОДНОЙ из 25 (self-play: 0 за 300 матчей),
  // поэтому вся ветка эффектов — бонусы к добыче, скорости и урону, гейты контента —
  // не участвовала в измерении баланса вовсе. Правило намеренно минимальное: бот не
  // «строит билд», он просто не оставляет исследовательские слоты пустыми.
  //
  // Что можно взять, решает САМО ЯДРО — `technologyLock` (prerequisites / day-gate /
  // conditions), а не копия правил здесь: разъедься копия с модулем, бот начал бы
  // спамить отказами, и первым признаком была бы не ошибка, а тихо изменившийся баланс.
  // Слоты считаем по базовой константе, а не по хуку `research.slots` (хук живёт внутри
  // ядра и снаружи не вызывается): с учёным слотов может быть больше, тогда бот
  // недоиспользует лишний — это честный недобор, а не отказ.
  const techState = pl.technologies;
  const activeTech = techState?.active ?? [];
  const doneTech = techState?.completed ?? [];
  // RQ-1: у места есть очередь исследований — это план игрока, и слоты кормит она (насос
  // ядра). Бот, сидящий за игрока (Хранитель, подмена), её не обгоняет своим выбором.
  const playerPlan = (techState?.queue?.length ?? 0) > 0;
  if (!swarmInhabitant && !playerPlan && (skilled || state.techRules?.ruleset === 'main') && activeTech.length < BASE_RESEARCH_SLOTS) {
    const costOf = (id: string): Record<string, number> =>
      matchCost(state, data.technologies[id]?.cost) ?? {};
    /** Чего не хватает на узел — с запасом `ORDER_RESERVE`, как у заказов войск. Прежний
     *  запас 60 на всё держал и микроэлектронику, а её у бота 40–150, и узлы второго
     *  тира (30–80 микроэлектроники) за 14 дней не брались почти никогда. */
    const shortOf = (id: string): string[] =>
      Object.entries(costOf(id))
        .filter(([r, v]) => (pl.resources[r] ?? 0) < v + pad(r, ORDER_RESERVE[r] ?? 0))
        .map(([r]) => r);
    // Доктрина: узлы своей ветки идут вперёд цены (ранг `doctrineRanks`). Без доктрины
    // ранг у всех один, и порядок прежний — по цене. Узел, запертый на учёного не из совета,
    // доктрине не цель: совет внутри матча неизменен, а линия Наместника (BAL-19) стала
    // высшим тиром «Командования» и увела бы туда путь Куратора.
    const reachable = (id: string): boolean =>
      techInMatch(state, id, data) &&
      (data.technologies[id]?.conditions ?? []).every(
        (c) => c.type !== 'has_scientist' || conditionMet(c, state, ai, data),
      );
    const ranks =
      doctrine !== undefined ? doctrineRanks(data.technologies, doctrine, reachable) : undefined;
    const rank = (id: string): number => {
      const def = data.technologies[id]!;
      if (def.ruleset === 'main' && def.tier === 1 && def.unlocks.units?.length) return -1;
      // BAL-19: планета за лимитом управления даёт половину и не строит юниты, поэтому узел,
      // поднимающий лимит, идёт вровень с путём доктрины, пока такие планеты есть.
      if (bot.beyondLimit && (def.effects.controlLimit ?? 0) > 0) return 0;
      return ranks?.get(id) ?? 2;
    };
    const open = Object.keys(data.technologies)
      .filter((id) => {
        const def = data.technologies[id];
        if (!def) return false;
        if (doneTech.includes(id) || activeTech.some((a) => a.technology === id)) return false;
        return technologyLock(def, state, ai, data, id) === null;
      })
      // Дешёвое и быстрое вперёд — это не «оптимальный порядок», а ДЕТЕРМИНИРОВАННЫЙ:
      // id последним ключом сортировки, чтобы порядок не зависел от перебора объекта
      // (иначе один и тот же сид разыгрался бы по-разному, инвариант #1).
      .sort((a, b) => {
        const da = data.technologies[a]!;
        const db = data.technologies[b]!;
        const sum = (c: Record<string, number> = {}): number =>
          Object.values(c).reduce((n, v) => n + v, 0);
        return (
          rank(a) - rank(b) ||
          sum(da.cost) - sum(db.cost) ||
          (da.researchTimeHours ?? 0) - (db.researchTimeHours ?? 0) ||
          (a < b ? -1 : a > b ? 1 : 0)
        );
      });
    const pick = open.find((id) => shortOf(id).length === 0);
    // КОПИЛКА ДОКТРИНЫ. Узел своей ветки, на который не хватает, бот не меняет на дешёвое
    // чужое, а копит: если доход закрывает нехватку за `DOCTRINE_SAVE_HOURS`, место ничего
    // другого не исследует, а заказы войск, тратящие недостающее, ждут (`finishTurn`).
    // Без копилки ветка не шла: стройка съедала металл и кредиты каждый тик, и шаттловое
    // место за 14 дней не доходило до «Ударных векторов», а с ними и до тяжёлого страйкера.
    // Доход не закроет нехватку за этот срок — узел не цель, и бот берёт что по карману.
    const goal = open.find(
      (id) =>
        rank(id) < Math.min(2, pick !== undefined ? rank(pick) : 2) &&
        shortOf(id).every((r) => {
          const gap = (costOf(id)[r] ?? 0) + pad(r, ORDER_RESERVE[r] ?? 0) - (pl.resources[r] ?? 0);
          return (flow[r] ?? 0) > 0 && gap <= (flow[r] ?? 0) * DOCTRINE_SAVE_HOURS;
        }),
    );
    if (goal !== undefined) bot.saving = new Set(shortOf(goal));
    else if (pick !== undefined) out.push(researchTech(ai, pick));
  }
}

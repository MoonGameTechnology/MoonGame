/**
 * Покрытие дерева технологий замером (BAL-12) — что прибор ВИДИТ, а чего не может
 * увидеть by construction.
 *
 * Две разные поправки, обе про честность отчёта:
 *
 *   • **грант-узлы.** Мета-прокачка командира выдаёт скрытые технологии как `completed`
 *     на старте матча (`meta.ts`, `metaGrant`) — они не исследуются и узлами сессии не
 *     являются. Окно дерева технологий это знало и показывало только настоящие узлы, но
 *     правило жило ровно там; харнес считал знаменатель «не исследовано ни разу» по
 *     всему каталогу и занижал долю мёртвого дерева.
 *   • **слой `has_scientist`.** Ноль у такого узла значит ТРИ разных вещи, и лечатся они
 *     в разных местах: нет учёного нужной ветки (дыра ростера — BAL-13), `dayGate` за
 *     концом окна замера (невидим прибору, и нерфить его по нулю нельзя) либо узел
 *     достижим и бот его не взял — вот это уже про баланс. Пока они сливались в один
 *     ноль, отчёт толкал чинить не то.
 *
 * Функции ЧИСТЫЕ и данные принимают аргументом: `prototype/src/**` собирается в
 * браузерный бандл, читает файлы вызывающий (харнес `selfplay.mjs` и тест).
 */
import type { TechnologyCondition } from '../../packages/shared-core/src/index';

/**
 * Узел, который в сессии исследовать нельзя: его только ВЫДАЮТ — мета-прокачка
 * командира или усиление забега (PVR-1.4).
 *
 * Признак — флаг `grantOnly` в самих данных, а не префикс имени. Префикс `meta_`
 * остаётся запасным ответом для вызова, у которого определения под рукой нет: он
 * держал это правило до того, как у правила появился дом, и снимать его отдельно
 * незачем. Настоящий запор — в ядре (`E_GRANT_ONLY`): прятать узел из окна мало,
 * окно не единственный отправитель приказа.
 */
export function isGrantOnlyTech(id: string, def?: { grantOnly?: boolean }): boolean {
  return def?.grantOnly === true || id.startsWith('meta_');
}

/** Настоящее дерево сессии — знаменатель всякой доли «сколько узлов пройдено». */
export function researchableTechIds(technologies: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(technologies)
    .filter(([id, def]) => !isGrantOnlyTech(id, def as { grantOnly?: boolean }))
    .map(([id]) => id);
}

/** Узел, запертый на научного руководителя, и три причины, по которым он может стоять
 *  в отчёте с нулём. */
export interface ScientistGateRow {
  id: string;
  /** Требуемая ветка учёного; `null` — годится любой. */
  branch: string | null;
  minLevel: number;
  dayGate: number;
  /** Сколько раз узел исследован за прогон. */
  researched: number;
  /** Есть ли в каталоге учёный, который этот узел вообще расгейчивает. */
  hasLeader: boolean;
  /** `dayGate` позже конца окна замера — узел невидим прибору by construction. */
  outsideWindow: boolean;
}

interface TechGate {
  dayGate: number;
  conditions: readonly TechnologyCondition[];
}

/** Строки слоя `has_scientist` в порядке каталога технологий. `sessionDays` — длина
 *  окна прогона: она и решает, «не взят» узел или замер до него не доживает. */
export function scientistGatedNodes(
  technologies: Readonly<Record<string, TechGate>>,
  scientists: Readonly<Record<string, { branch?: string }>>,
  researched: ReadonlyMap<string, number>,
  sessionDays: number,
): ScientistGateRow[] {
  const rows: ScientistGateRow[] = [];
  for (const [id, def] of Object.entries(technologies)) {
    for (const cond of def.conditions ?? []) {
      if (cond.type !== 'has_scientist') continue;
      const branch = cond.branch ?? null;
      rows.push({
        id,
        branch,
        minLevel: cond.minLevel,
        dayGate: def.dayGate,
        researched: researched.get(id) ?? 0,
        hasLeader: Object.values(scientists).some(
          (sci) => branch === null || sci.branch === branch,
        ),
        outsideWindow: def.dayGate > sessionDays,
      });
      break; // узел показывается один раз, даже если условий на учёного несколько
    }
  }
  return rows;
}

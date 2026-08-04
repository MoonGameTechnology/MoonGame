/**
 * CHAIN-UX «Приказ» — чистая модель режима построения цепочки тапами по карте.
 *
 * Заказ владельца дословно: «кнопка приказ, на мобиле убирается нижний хаб и тыкаешь
 * точку на карте и в зависимости от того что это, там появятся возможные действия.
 * На карте рисуется вся эта цепочка и в точках действия иконки приказов и показ
 * времени до исполнения. И так приказ за приказом».
 *
 * Ядро цепочек (CC-1) уже многоточечное — каждый шаг несёт свою цель, план ставится
 * одним `order.chain`. Этот модуль НИЧЕГО не знает о живом состоянии: main.ts
 * скармливает ему числа и коллбеки, получает обратно черновик, пункты меню и разметку.
 * Так арифметика «что можно в этой точке» и «когда исполнится» накрывается тестами
 * без DOM — у прежнего композера TGT-1 покрытия не было вовсе.
 *
 * Три инварианта модели:
 * - Черновик набирается ЖЕСТАМИ: один выбор в меню = один жест, даже если он лёг
 *   двумя шагами (курс + штурм). `undoGesture` снимает жест целиком — «отменить
 *   последнее» на телефоне обязано быть одним касанием.
 * - Действие в точке, которая ещё не финиш маршрута, само дописывает перелёт к ней:
 *   игрок думает точками, а не шагами. Наращивание часов (⏱/🎌 повторными тапами)
 *   вливается в предыдущий жест — 4 таба ⏱ это один жест «жди 4 часа».
 * - Кламп, а не отказ: часы растут до капа ядра (MAX_CHAIN_WAIT_HOURS), шаги — до
 *   MAX_CHAIN_STEPS; невозможный пункт меню СЕРЫЙ с причиной, написанной в нём самом
 *   (клик по disabled не всплывает — объяснить постфактум нечем).
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { MAX_CHAIN_STEPS, MAX_CHAIN_WAIT_HOURS, type ChainStep } from './chain';

/** Что за точка под пальцем. `fleet` — вражеский флот; остальное — миры. */
export type ChainPointKind = 'own' | 'enemy' | 'neutral' | 'fleet';

export interface ChainPoint {
  id: string;
  kind: ChainPointKind;
}

/** Черновик плана: шаги + границы жестов (длины) для атомарного отката. */
export interface ChainDraft {
  steps: ChainStep[];
  gestures: number[];
}

export const emptyDraft = (): ChainDraft => ({ steps: [], gestures: [] });

/** Черновик из уже отправленного плана: весь префилл — один жест (⟲ снимает целиком). */
export function draftFrom(steps: ChainStep[]): ChainDraft {
  return { steps: [...steps], gestures: steps.length ? [steps.length] : [] };
}

/** Финиш маршрута черновика: мир последнего перелёта, иначе стартовый узел. */
export function draftFinish(steps: ChainStep[], startId: string | null): string | null {
  let cur = startId;
  for (const st of steps) if (st.kind === 'move') cur = st.to;
  return cur;
}

export type ChainAct = 'move' | 'wait' | 'wait6' | 'assault' | 'fire' | 'ability';

export interface ChainAbility {
  id: string;
  /** Уже локализованное имя (модуль не ходит в каталоги данных). */
  name: string;
  /** Остаток кулдауна в игро-часах (0 — готова). */
  cdH: number;
  ranged: boolean;
}

export interface ChainMenuOpts {
  /** Мир можно штурмовать (capturable-сектор чужого владельца). */
  capturable: boolean;
  /** В выделении есть артиллерия — гейт огневых пунктов. */
  hasArtillery: boolean;
  /** Способности героя на борту (пусто — героя нет). */
  abilities: ChainAbility[];
}

export interface ChainMenuItem {
  act: ChainAct;
  label: string;
  disabled: boolean;
  /** Причина серости — пишется прямо в пункте (title). */
  why?: string;
  /** Выбор НЕ закрывает меню — наращивание часов повторными тапами. */
  keep?: boolean;
  ability?: string;
}

/** Применить пункт меню к черновику. `null` — применить нельзя (пункт серый). */
export function applyMenuAction(
  draft: ChainDraft,
  act: ChainAct,
  point: ChainPoint,
  startId: string | null,
  ability?: ChainAbility,
): ChainDraft | null {
  const steps = [...draft.steps];
  const gestures = [...draft.gestures];
  const finish = draftFinish(steps, startId);
  // Точка ещё не финиш — жест начинается с перелёта к ней (мирам; флот не точка маршрута).
  const needMove = point.kind !== 'fleet' && finish !== point.id;
  const room = MAX_CHAIN_STEPS - steps.length;
  const grow = (extraH: number): ChainDraft | null => {
    const last = steps[steps.length - 1];
    if (!last || (last.kind !== 'wait' && last.kind !== 'strike')) return null;
    if (last.hours >= MAX_CHAIN_WAIT_HOURS) return null;
    steps[steps.length - 1] = {
      ...last,
      hours: Math.min(MAX_CHAIN_WAIT_HOURS, last.hours + extraH),
    };
    return { steps, gestures };
  };
  const push = (added: ChainStep[]): ChainDraft | null => {
    const gesture = [...(needMove ? [{ kind: 'move', to: point.id } as ChainStep] : []), ...added];
    if (gesture.length > room) return null;
    steps.push(...gesture);
    gestures.push(gesture.length);
    return { steps, gestures };
  };
  switch (act) {
    case 'move':
      return needMove ? push([]) : null; // уже финиш — лететь некуда
    case 'wait':
    case 'wait6': {
      const n = act === 'wait6' ? 6 : 1;
      // Повторный тап растит ПОСЛЕДНЮЮ задержку в этой же точке, не плодя шаги.
      const last = steps[steps.length - 1];
      if (!needMove && last?.kind === 'wait') return grow(n);
      return push([{ kind: 'wait', hours: n }]);
    }
    case 'assault':
      return point.kind === 'enemy' ? push([{ kind: 'assault' }]) : null;
    case 'fire': {
      const target = point.kind === 'fleet' ? point.id : null;
      const last = steps[steps.length - 1];
      if (!needMove && last?.kind === 'strike' && last.target === target) return grow(1);
      return push([{ kind: 'strike', target, hours: 1 }]);
    }
    case 'ability': {
      if (!ability || room < 1) return null;
      steps.push({
        kind: 'ability',
        abilityId: ability.id,
        ...(ability.ranged && point.kind !== 'fleet' ? { target: point.id } : {}),
      });
      gestures.push(1);
      return { steps, gestures };
    }
  }
}

/** Снять последний жест целиком (курс+штурм уходят одной кнопкой ⟲). */
export function undoGesture(draft: ChainDraft): ChainDraft {
  if (!draft.gestures.length) return draft;
  const n = draft.gestures[draft.gestures.length - 1]!;
  return {
    steps: draft.steps.slice(0, draft.steps.length - n),
    gestures: draft.gestures.slice(0, -1),
  };
}

/** Пункты меню для точки — «в зависимости от того, что это». Серость считается
 *  сухим прогоном applyMenuAction: меню никогда не предлагает невозможного. */
export function chainMenuItems(
  draft: ChainDraft,
  point: ChainPoint,
  startId: string | null,
  opts: ChainMenuOpts,
): ChainMenuItem[] {
  const items: ChainMenuItem[] = [];
  const can = (act: ChainAct, ab?: ChainAbility): boolean =>
    applyMenuAction(draft, act, point, startId, ab) !== null;
  const fullWhy = (ok: boolean): string | undefined => (ok ? undefined : t('chain.full'));
  if (point.kind !== 'fleet') {
    const mv = can('move');
    items.push({ act: 'move', label: `✈ ${t('tgt.step.here')}`, disabled: !mv });
    const w1 = can('wait');
    items.push({ act: 'wait', label: t('tgt.add-wait'), disabled: !w1, keep: true, why: fullWhy(w1) });
    const w6 = can('wait6');
    items.push({ act: 'wait6', label: t('chain.add-wait6'), disabled: !w6, keep: true, why: fullWhy(w6) });
  }
  if (point.kind === 'enemy' && opts.capturable) {
    const ok = can('assault');
    items.push({ act: 'assault', label: `⚔ ${t('cmd.assault')}`, disabled: !ok, why: fullWhy(ok) });
  }
  if (point.kind === 'enemy' || point.kind === 'fleet') {
    const ok = opts.hasArtillery && can('fire');
    items.push({
      act: 'fire',
      label: t('chain.fire'),
      disabled: !ok,
      keep: true,
      why: opts.hasArtillery ? fullWhy(ok) : t('chain.no-art'),
    });
  }
  if (point.kind !== 'fleet') {
    for (const ab of opts.abilities) {
      const ok = ab.cdH <= 0 && can('ability', ab);
      items.push({
        act: 'ability',
        ability: ab.id,
        label: `★ ${ab.name}${ab.cdH > 0 ? ` ${t('hero.abil.cooldown', { h: fmtCd(ab.cdH) })}` : ''}`,
        disabled: !ok,
      });
    }
  }
  return items;
}

/** «≈14ч» для бейджа кулдауна — своя мини-копия fmtHrs, чтобы не тянуть main.ts. */
const fmtCd = (h: number): string => t('fmt.hours', { n: Math.max(1, Math.round(h)) });

// ---------------------------------------------------------------------------
// Время до исполнения

export interface ChainTimePoint {
  /** Мир, у которого стоит шаг (для флот-целей — точка не меняется). */
  pointId: string | null;
  /** Накопленные часы до КОНЦА шага; null — маршрут не строится (оценки дальше нет). */
  endH: number | null;
}

/** Накопленное время по шагам. `baseH` — часы до старта первого шага (остаток
 *  текущего перелёта / взведённой задержки); `travelH` — оценка перелёта между
 *  узлами (null — маршрута нет); `abilityHoldH` — остаток кулдауна способности:
 *  единственный холд драйвера, без него времена хвоста систематически врут.
 *  `headRemH` — остаток ПЕРВОГО wait/strike, если драйвер его уже взвёл. */
export function chainTimeline(
  steps: ChainStep[],
  startId: string | null,
  baseH: number,
  travelH: (from: string, to: string) => number | null,
  abilityHoldH: (abilityId: string) => number,
  headRemH?: number,
): ChainTimePoint[] {
  const out: ChainTimePoint[] = [];
  let cur = startId;
  let h: number | null = baseH;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (h !== null) {
      if (st.kind === 'move') {
        const dt = cur ? travelH(cur, st.to) : null;
        h = dt === null ? null : h + dt;
      } else if (st.kind === 'wait' || st.kind === 'strike') {
        h += i === 0 && headRemH !== undefined ? headRemH : st.hours;
      } else if (st.kind === 'ability') {
        h += Math.max(0, abilityHoldH(st.abilityId));
      }
      // assault: выдаётся мгновенно; длительность самого боя неизвестна и не обещается
    }
    if (st.kind === 'move') cur = st.to;
    out.push({ pointId: cur, endH: h });
  }
  return out;
}

/** Глиф шага для капсулы на карте. */
export function stepGlyph(st: ChainStep): string {
  switch (st.kind) {
    case 'move':
      return '✈';
    case 'wait':
      return '⏱';
    case 'assault':
      return '⚔';
    case 'ability':
      return '★';
    default:
      return '🎯';
  }
}

/** Подпись часов шага для капсулы (пусто — шаг без длительности). */
export function stepHours(st: ChainStep): string {
  if (st.kind === 'wait') return t('tgt.wait', { n: st.hours });
  if (st.kind === 'strike') return t('tgt.at', { n: st.hours });
  return '';
}

// ---------------------------------------------------------------------------
// Разметка (строки — тестируется без DOM)

export interface ChainStripModel {
  fleets: number;
  count: number;
  cap: number;
  canUndo: boolean;
  canHome: boolean;
  /** Черновик пуст, но у флотов есть живой план — ✓ превращается в «снять приказ». */
  clearMode: boolean;
  canSend: boolean;
  /** У флотов группы РАЗНЫЕ живые планы — отправка заменит все одинаково. */
  overwrite: boolean;
}

/** Полоска режима вместо cmdbar. Времена в разметку НЕ входят — их патчит
 *  updateChainLive() через textContent (перестройка DOM каждый кадр ела бы тапы). */
export function chainStripHtml(m: ChainStripModel): string {
  const label =
    `<span class="chlabel">◎ ${esc(t('tgt.title'))}` +
    (m.fleets > 1 ? ` · ${esc(t('tgt.fleets', { n: m.fleets }))}` : '') +
    (m.count > 0
      ? ` · <b>${m.count}/${m.cap}</b> · <b class="ch-eta"></b>`
      : ` · <i class="chhint">${esc(t('hint.pick-order'))}</i>`) +
    (m.overwrite ? ` <b class="chwarn" title="${esc(t('chain.overwrite'))}">⚠</b>` : '') +
    `</span>`;
  const btn = (cmd: string, icon: string, lbl: string, disabled: boolean, cls = ''): string =>
    `<button data-cmd="${cmd}" class="${cls}" title="${esc(lbl)}" aria-label="${esc(lbl)}" ${disabled ? 'disabled' : ''}><span class="ci">${icon}</span><span class="cl">${esc(lbl)}</span></button>`;
  return (
    label +
    btn('chundo', '⟲', t('chain.undo'), !m.canUndo) +
    btn('chhome', '⌂', t('tgt.step.home'), !m.canHome) +
    btn('chsend', '✓', m.clearMode ? t('tgt.clear') : t('tgt.send'), !m.canSend, 'on') +
    btn('chexit', '✕', t('ping.cancel'), false, 'danger')
  );
}

/** Меню точки — рендерится в тот же плавающий бокс, что старый композер (#tgted). */
export function chainMenuHtml(title: string, sub: string, items: ChainMenuItem[]): string {
  const rows = items
    .map(
      (it) =>
        `<button data-ch="${it.act}"${it.ability ? ` data-chab="${esc(it.ability)}"` : ''}${it.keep ? ' data-keep="1"' : ''}${it.why ? ` title="${esc(it.why)}"` : ''} ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`,
    )
    .join('');
  return (
    `<div class="tg-top"><b>◎ ${esc(title)}</b><span>${esc(sub)}</span></div>` +
    `<div class="tg-add">${rows}</div>`
  );
}

/**
 * ОКНО БОЯ — кто дерётся за этот узел и какими силами (заказ владельца 2026-09-15; схема
 * рядами — заказ 2026-11-17, макет v5).
 *
 * Окно открывается тапом по значку боя на карте (`decisions/battleTap.ts`) и показывает то,
 * чего карточка флота показать не могла: ВСЕ стороны разом, с ролями и силами.
 *
 * Форма та же, что у остальных REFM-экранов: всё, что только считает и верстает, — чистая
 * экспортируемая функция (проверяется без DOM), а `initBattleWindow(host)` берёт
 * зависимости явно.
 *
 * 1. **Схема рядами, а не колонки карточек.** Сверху — противники, снизу — свои, каждая
 *    сторона — маленькая плитка; стрелки показывают, куда идут НАШИ залпы (куда целится
 *    враг — не видно). Кто в каком ряду и что видно — `decisions/battleScheme.ts`,
 *    разметка — `battleRows.ts`, стрелки — `battleArrows.ts`.
 * 2. **Всё о стороне — в её листе по нажатию на плитку**: корпус, щит, урон, эффекты,
 *    состав. На телефоне лист выезжает снизу поверх схемы, на ПК встаёт панелью справа и
 *    схему не закрывает.
 * 3. **Приказы — плитками внизу, для выделенного своего флота.** Свой флот один — он выделен
 *    сразу; своих несколько — внизу «Атака всеми» и «Отступить всеми», пока не выбран один.
 * 4. **Ролю берём У СТОРОНЫ, а не из места в списке.** Атакующих может быть несколько
 *    (MSB-3/MSB-4), и порядок о роли не говорит ничего.
 * 5. **Прогноз — в своём бою, сколько бы в нём ни было сторон (UIX-6.2, UIX-6.3).** Он
 *    считается от текущего состава, поэтому новый раунд сам даёт новый прогноз. В чужом
 *    бою прогноза нет: победа и поражение бывают только у своей стороны.
 * 6. **Пустое окно не открывается молча.** Бой мог кончиться, пока палец летел к экрану;
 *    честная строка лучше пустой рамки.
 * 7. **Правила — под «?», на виду одна строка (UIX-6.2).** Цена отхода нужна в момент
 *    решения, поэтому видна она; остальное раскрывается нажатием.
 */
import { t } from '../../localization/runtime';
import { esc, displayUnit, fmtHrs, kfmt, runClockShown } from './format';
import { runRealSeconds } from '../../decisions/runClock';
import type { EngageForecastCard } from '../../decisions/engageForecast';
import { hullTone, meterShare } from '../../decisions/battleBalance';
import { veteranBadge } from '../../decisions/veteranBadge';
import { visibleVolleys } from '../../decisions/battleScheme';
import { landingBattleOf } from '../../packages/shared-core/src/state/battle';
import type { GameState, PlayerId } from '../../packages/shared-core/src/index';
import type { BattleModel } from '../../packages/client/src/matchHud';
import {
  ownerLabel,
  sideAlive,
  sideColor,
  sideFleetId,
  sideKey,
  sideKindLabel,
  sideName,
  type BattleView,
  type Side,
} from './battleSide';
import {
  boardHtml,
  filtersHtml,
  ordersHtml,
  schemeArrows,
  schemeHtml,
  schemeLayout,
  shareLabel,
  shownArrows,
  type Lane,
  type SchemeArrow,
} from './battleRows';
import { drawSchemeArrows } from './battleArrows';

export type { BattleView } from './battleSide';

/** Что окну нужно от хоста — ровно и только это. */
export interface BattleWindowHost {
  root: () => HTMLElement;
  body: () => HTMLElement;
  /** Заголовок в шапке окна — туда пишется {@link battleHeadHtml}. Нет узла — шапка
   *  остаётся той, что в разметке. */
  head?: () => HTMLElement | null;
  /** Место листа стороны (правило 2). Нет узла — лист дописывается в конец тела. */
  sheet?: () => HTMLElement | null;
  state: () => GameState;
  me: () => PlayerId;
  /** Модель боя (из `@void/client`), либо null — бой исчез или под туманом. */
  model: (battleId: string) => BattleModel | null;
  retreat: (fleetId: string) => void;
  attack?: (battleId: string, side?: string) => void;
  retreatAll?: (battleId: string) => void;
  /** Оформление (заказ владельца 2026-09-23) — всё необязательно: без него окно честно
   *  рисуется нейтральным цветом, сырым id и без строки авто-отхода. */
  view?: BattleView;
}

/** Словом рядом с цветом шкалы: цвет не единственный носитель смысла. */
const TONE_KEY = {
  ok: 'battle.win.tone.ok',
  hurt: 'battle.win.tone.hurt',
  low: 'battle.win.tone.low',
} as const;

/** Шкала: заливка по доле + подпись поверх. Нет максимума — шкалы нет. */
function meter(
  v: { current: number; max: number } | undefined,
  cls: string,
  label: string,
  note = '',
): string {
  if (!v || !(v.max > 0)) return '';
  const pct = Math.round(meterShare(v.current, v.max) * 100);
  return (
    `<div class="bw-meter ${cls}"><i style="width:${pct}%"></i>` +
    `<span>${esc(label)} ${Math.round(v.current)}/${Math.round(v.max)}${note ? ` · ${esc(note)}` : ''}</span></div>`
  );
}

/** Local window state never changes the game projection. */
export interface BattleWindowOptions {
  expanded?: ReadonlySet<string>;
  fullComposition?: ReadonlySet<string>;
  effects?: ReadonlySet<string>;
  ended?: boolean;
  retreats?: readonly string[];
  /** Раскрыты ли правила под «?» (UIX-6.2). */
  rules?: boolean;
  /** Выделенная своя сторона; `null` — «все флоты», нет — по умолчанию (правило 3). */
  sel?: string | null;
  /** Сторона, чей лист открыт (правило 2). */
  sheet?: string | null;
  /** Чьи стрелки: все наши или только мои. */
  arrows?: 'all' | 'mine';
  /** Рисовать ли ответы пунктиром. */
  replies?: boolean;
  /** Раскрытые ряды «+N». */
  openLanes?: ReadonlySet<Lane>;
}

function sourceName(source: string): string {
  const names: Record<string, string> = {
    sector: t('battle.win.source-sector'),
    'planet-type': t('battle.win.source-planet'),
    hero: t('battle.win.source-hero'),
    heroEffects: t('battle.win.source-aura'),
    construction: t('battle.win.source-fort'),
    technology: t('battle.win.source-tech'),
    faction: t('battle.win.source-faction'),
    veteran: t('battle.win.source-veteran'),
    promotion: t('battle.win.source-promotion'),
    hunger: t('battle.win.source-hunger'),
  };
  return names[source] ?? t('battle.win.source-other');
}

function effectsHtml(side: Side, view: BattleView, open: boolean): string {
  const mods = side.readout?.modifiers ?? [];
  if (!mods.length) return `<p class="bw-no-effects">${esc(t('battle.win.effects-empty'))}</p>`;
  const buffs = mods.filter((m) => m.beneficial).length;
  const rows = mods
    .map((m) => {
      const n = `${m.value > 0 ? '+' : '−'}${Math.round(Math.abs(m.value) * 1000) / 10}`;
      const value = m.hook === 'combat.damage' ? `${n}%` : t('battle.win.point-value', { n });
      const metric =
        m.hook === 'combat.mitigation'
          ? t('battle.win.mitigation')
          : t(m.direction === 'outgoing' ? 'battle.win.outgoing' : 'battle.win.incoming');
      return (
        `<li class="${m.beneficial ? 'buff' : 'debuff'}"><b>${m.beneficial ? '+' : '−'} ${esc(sourceName(m.source))}</b>` +
        `<span>${esc(metric)} ${esc(value)}</span><small>${esc(t('battle.win.against', { name: view.ownerName?.(m.against) ?? m.against ?? '—' }))}</small></li>`
      );
    })
    .join('');
  return (
    `<button class="bw-effect-toggle" data-battle-effects="${esc(sideKey(side))}" aria-expanded="${open}">${esc(t('battle.win.effects', { buffs, debuffs: mods.length - buffs }))}</button>` +
    (open
      ? `<div class="bw-effects"><ul>${rows}</ul><p>${esc(t('battle.win.effects-condition'))}</p></div>`
      : '')
  );
}

/** Лист стороны: корпус, щит, урон, эффекты и состав. Приказов в листе нет — они плитками
 *  внизу окна (правило 3); строка авто-отхода своего флота остаётся здесь. */
export function sideRowHtml(
  side: Side,
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  const key = sideKey(side);
  const expanded = options.expanded?.has(key) ?? true;
  const count = (side.stacks ?? side.units).filter((u) => u.count > 0).length;
  const full = options.fullComposition?.has(key) ?? false;
  const fleetId = sideFleetId(side);
  const kind = sideKindLabel(side);
  const name = sideName(side, view);
  const badge = side.mine
    ? t('battle.win.you')
    : side.relation === 'ally'
      ? t('battle.win.ally')
      : side.relation === 'neutral'
        ? t('battle.win.neutral')
        : '';
  const col = sideColor(side, view);
  const tone = side.hull ? hullTone(side.hull.current, side.hull.max) : 'ok';
  const vet = veteranBadge(side.veteran, side.veteranHull);
  const damage = side.readout;
  const defense = damage
    ? Math.round(damage.defense.min) === Math.round(damage.defense.max)
      ? kfmt(damage.defense.max)
      : `${kfmt(damage.defense.min)}–${kfmt(damage.defense.max)}`
    : '—';
  const tiles = expanded
    ? (view.tiles?.(side, full ? Infinity : 16, col) ??
      side.units
        .slice(0, full ? undefined : 16)
        .map((u) => `<span class="bw-unit"><b>${u.count}×</b> ${esc(displayUnit(u.unit))}</span>`)
        .join(''))
    : '';
  const autoAt = side.mine && fleetId ? view.autoRetreatAt?.(fleetId) : undefined;
  return (
    `<article class="bw-side${side.mine ? ' mine' : ''} ${side.role}" style="--own:${esc(col)}">` +
    `<div class="bw-who"><div><b>${esc(name)}</b><small>${esc(ownerLabel(side, view))} · ${esc(kind)}</small></div>` +
    (badge ? `<em class="bw-you">${esc(badge)}</em>` : '') +
    `<span class="bw-role">${esc(t(side.role === 'attacker' ? 'battle.win.role.attacker' : 'battle.win.role.defender'))}</span></div>` +
    meter(side.hull, `hull tone-${tone}`, t('battle.win.hull'), t(TONE_KEY[tone])) +
    meter(side.shield, 'shield', t('battle.win.shield')) +
    `<div class="bw-damage" title="${esc(t('battle.win.damage-hint'))}"><div><span>⚔ ${esc(t('battle.win.attack-damage'))}</span><b>${damage ? kfmt(damage.attack) : '—'}</b></div>` +
    `<div><span>⛨ ${esc(t('battle.win.defense-damage'))}</span><b>${defense}</b></div></div>` +
    (vet
      ? `<span class="bw-vet" title="${esc(vet.title)}" aria-label="${esc(vet.title)}">${vet.glyph}${esc(vet.text)}</span>`
      : '') +
    (!options.ended
      ? side.role === 'defender'
        ? `<p class="bw-response">⛨ ${esc(t('battle.win.response'))}</p>`
        : `<div class="bw-clock"><span>${esc(t('battle.win.next-attack'))}</span><b class="pn-timer" data-at="${side.nextAttackAt ?? ''}">…</b></div>`
      : '') +
    (autoAt !== undefined
      ? `<p class="bw-auto">${esc(autoAt === null ? t('battle.win.auto.off') : t('battle.win.auto.on', { n: Math.round(autoAt * 100) }))}</p>`
      : '') +
    effectsHtml(side, view, options.effects?.has(key) ?? false) +
    `<button class="bw-expand" data-battle-expand="${esc(key)}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${esc(t('battle.win.composition', { n: count }))}</button>` +
    (expanded
      ? `<div class="ptiles bw-tiles">${tiles}</div>` +
        (count > 16
          ? `<button class="bw-more" data-battle-more="${esc(key)}">${esc(full ? t('battle.win.less') : t('battle.win.more', { n: count - 16 }))}</button>`
          : '')
      : '') +
    `</article>`
  );
}

/** Прогноз (правило 5): слово итога, срок и потери; цвет лишь дублирует слово. */
function forecastHtml(c: EngageForecastCard | null | undefined): string {
  if (!c) return '';
  return (
    `<p class="bw-forecast ${c.tone}"><b>${esc(t(c.verdictKey))}</b>` +
    `<span>${esc(t('engage.forecast.line', { h: fmtHrs(c.hours), own: c.ownLossPct, foe: c.foeLossPct }))}</span></p>`
  );
}

/** Правила под «?» (правило 7): строка на виду и есть кнопка, подробности — по нажатию. */
function rulesHtml(line: string, detail: readonly string[], open: boolean): string {
  return (
    `<button class="bw-rules-toggle" data-battle-rules aria-expanded="${open}"><span>${esc(line)}</span><i aria-hidden="true">?</i></button>` +
    (open ? `<div class="bw-rules">${detail.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '')
  );
}

/**
 * Шапка окна: где бой, фаза и сколько сторон (заказ владельца 2026-09-28). Нет модели —
 * просто «Бой».
 */
export function battleHeadHtml(m: BattleModel | null, view: BattleView = {}): string {
  if (!m) return `<b>${esc(t('battle.win.head'))}</b>`;
  const ground = m.phase === 'ground';
  return (
    `<b>${esc(t('battle.win.at', { w: view.placeName?.(m.location) ?? m.location }))}</b>` +
    `<span class="bw-phase${ground ? ' ground' : ''}">${esc(t(ground ? 'battle.win.phase.ground' : 'battle.win.phase.orbit'))} · ${esc(t('battle.win.sides', { n: m.sides.length }))}</span>`
  );
}

/** Прогноз по текущему составу сторон (правило 5); в кончившемся бою — нет. */
function windowForecast(m: BattleModel, view: BattleView, options: BattleWindowOptions): string {
  if (options.ended) return '';
  return forecastHtml(
    view.forecast?.(
      m.sides.map((s) => ({
        mine: s.mine,
        ...(s.relation === 'ally' ? { ally: true } : {}),
        role: s.role,
        ...(s.attackOrdered ? { attackOrdered: true } : {}),
        ...(s.nextAttackAt !== undefined ? { nextAttackAt: s.nextAttackAt } : {}),
        units: s.stacks ?? s.units,
        owner: s.owner,
        ...(s.ref?.kind === 'fleet' ? { key: s.ref.fleetId } : {}),
        ...(s.kind === 'garrison' ? { holds: true } : {}),
        ...(s.fortress ? { fortress: s.fortress } : {}),
      })),
    ),
  );
}

/** Тело окна: табло, фильтры стрелок, схема рядами, правила и плитки приказов. */
export function battleWindowHtml(
  m: BattleModel | null,
  retreats: readonly string[] = [],
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  if (!m) return `<p class="bw-empty">${esc(t('battle.win.empty'))}</p>`;
  const opts = { ...options, retreats };
  const layout = schemeLayout(m, view, opts);
  const arrows = schemeArrows(m, view, opts, layout);
  const ground = m.phase === 'ground';
  const orders = !options.ended && m.sides.some((s) => s.mine);
  const rule = runClockShown()
    ? t('battle.win.rule.run', { n: runRealSeconds(3_600_000) })
    : t('battle.win.rule');
  return (
    boardHtml(m, view, opts, layout, windowForecast(m, view, options)) +
    filtersHtml(arrows, opts) +
    schemeHtml(view, opts, layout, arrows.length === 0) +
    rulesHtml(
      !orders
        ? t('battle.win.rules')
        : ground
          ? t('battle.win.ground-retreat')
          : t('battle.win.retreat-cost'),
      orders && !ground ? [t('battle.win.retreat-rules'), rule] : [rule],
      options.rules ?? false,
    ) +
    ordersHtml(m, view, opts, layout)
  );
}

/** Стрелки, которые окно рисует сейчас: видимые игроку и прошедшие фильтры. */
export function battleWindowArrows(
  m: BattleModel | null,
  view: BattleView = {},
  options: BattleWindowOptions = {},
): SchemeArrow[] {
  if (!m) return [];
  return shownArrows(schemeArrows(m, view, options, schemeLayout(m, view, options)), options);
}

/** По кому бьёт сторона — строкой листа: свои — целями с долями, враг — «не видно». */
function aimLine(m: BattleModel, side: Side, view: BattleView): string {
  if (side.role !== 'attacker' || !sideAlive(side)) return '';
  if (!side.mine && side.relation !== 'ally')
    return `<p class="bw-aim">${esc(t('battle.win.aim-hidden'))}</p>`;
  const key = sideKey(side);
  const hostile = view.hostile ?? ((a, b) => a !== b);
  const seats = m.sides.map((s) => ({
    key: sideKey(s),
    owner: s.owner,
    mine: s.mine,
    ally: s.relation === 'ally',
    attacks: s.role === 'attacker',
    alive: sideAlive(s),
  }));
  const names = visibleVolleys(seats, hostile)
    .filter((v) => !v.reply && v.from === key)
    .map((v) => {
      const target = m.sides.find((s) => sideKey(s) === v.to);
      const name = target ? sideName(target, view) : v.to;
      return v.of > 1 ? `${name} (${shareLabel(v.of)})` : name;
    });
  return names.length
    ? `<p class="bw-aim">${esc(t('battle.win.hits', { list: names.join(', ') }))}</p>`
    : '';
}

/** Лист стороны (правило 2) или пусто, когда лист закрыт или стороны больше нет. */
export function battleSheetHtml(
  m: BattleModel | null,
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  const side = m?.sides.find((s) => sideKey(s) === options.sheet);
  if (!m || !side) return '';
  return (
    `<div class="bw-sheet-dim" data-battle-sheet-close></div>` +
    `<section class="bw-sheet" aria-label="${esc(sideName(side, view))}">` +
    `<div class="bw-sheet-h"><span class="bw-grab" aria-hidden="true"></span>` +
    `<button class="bw-sheet-x btn-x" data-battle-sheet-close aria-label="${esc(t('card.close'))}">✕</button></div>` +
    sideRowHtml(side, view, options) +
    (options.ended ? '' : aimLine(m, side, view)) +
    `</section>`
  );
}

/**
 * Бой кончился, пока окно открыто (решение владельца 2026-09-25): итог строкой журнала и
 * последний снимок сторон под ним — до закрытия, а не «об этом бое ничего не известно».
 * Отсчёта раунда, стрелок и приказов нет: раундов больше не будет, отходить не из чего.
 */
export function battleEndedHtml(
  last: BattleModel | null,
  summary: string,
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  const banner = `<div class="bw-ended"><b>${esc(t('battle.win.ended'))}</b><p>${esc(summary)}</p></div>`;
  if (!last) return banner;
  const { nextRoundAt: _gone, ...still } = last;
  return banner + battleWindowHtml(still, [], view, { ...options, ended: true });
}

/** Current membership, never the unrelated fleet selected behind the window. */
export function battleRetreats(state: GameState, id: string, me: PlayerId): string[] {
  return (state.battles[id]?.sides ?? []).flatMap((side) =>
    state.battles[id]?.phase === 'orbital' &&
    side.ref.kind === 'fleet' &&
    !landingBattleOf(state, side.ref.fleetId, id) &&
    side.owner === me &&
    state.fleets[side.ref.fleetId]?.owner === me &&
    state.fleets[side.ref.fleetId]?.battleId === id
      ? [side.ref.fleetId]
      : [],
  );
}

export function initBattleWindow(host: BattleWindowHost): {
  open: (battleId: string) => void;
  /** Бой кончился (`battle.resolved`): окно на нём держит итог до закрытия. */
  ended: (battleId: string, summary: string) => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let shown: string | null = null;
  /** Последний снимок показанного боя и его итог, если бой уже кончился. */
  let lastModel: BattleModel | null = null;
  let summary: string | null = null;
  const isOpen = (): boolean => host.root().classList.contains('show');
  let lastHtml = '';
  let lastSheet = '';
  let lastHead = '';
  let expanded: Set<string> | undefined;
  const fullComposition = new Set<string>();
  const effects = new Set<string>();
  const openLanes = new Set<Lane>();
  let rules = false;
  let sel: string | null | undefined;
  let sheet: string | null = null;
  let arrowsPick: 'all' | 'mine' = 'all';
  let replies = true;
  /** Стрелки последней отрисовки: перерисовываются по месту плиток, когда меняется окно. */
  let arrows: SchemeArrow[] = [];
  const options = (): BattleWindowOptions => ({
    ...(expanded ? { expanded } : {}),
    fullComposition,
    effects,
    rules,
    ...(sel !== undefined ? { sel } : {}),
    sheet,
    arrows: arrowsPick,
    replies,
    openLanes,
  });
  const sheetHost = (): HTMLElement | null => host.sheet?.() ?? null;
  const draw = (): void => {
    const scheme = host.body().querySelector<HTMLElement>('.bw-scheme');
    if (scheme) drawSchemeArrows(scheme, arrows);
  };
  const repaint = (): void => {
    if (!isOpen() || shown === null) return;
    const model = host.model(shown);
    if (model) lastModel = model;
    const ended = !model && summary !== null;
    const opts = options();
    const html = ended
      ? battleEndedHtml(lastModel, summary!, host.view, opts)
      : battleWindowHtml(
          model,
          model ? battleRetreats(host.state(), shown, host.me()) : [],
          host.view,
          opts,
        );
    const snapshot = ended ? lastModel : model;
    const sheetHtml = battleSheetHtml(snapshot, host.view, { ...opts, ended });
    const place = sheetHost();
    const changed = html !== lastHtml || sheetHtml !== lastSheet;
    if (html !== lastHtml || (!place && sheetHtml !== lastSheet)) {
      const scroll = host.body().scrollTop;
      host.body().innerHTML = place ? html : html + sheetHtml;
      host.body().scrollTop = scroll;
      lastHtml = html;
    }
    if (place && sheetHtml !== lastSheet) {
      place.innerHTML = sheetHtml;
      place.hidden = !sheetHtml;
    }
    lastSheet = sheetHtml;
    host.root().classList.toggle('has-sheet', !!sheetHtml);
    if (changed) {
      arrows = ended ? [] : battleWindowArrows(model, host.view, opts);
      draw();
    }
    // Шапка — по тому же снимку, что и тело: кончившийся бой держит в ней своё место.
    const head = battleHeadHtml(snapshot, host.view);
    if (head !== lastHead) {
      const el = host.head?.();
      if (el) el.innerHTML = head;
      lastHead = head;
    }
    // Отсчёт живёт ВНЕ подписи разметки: вписанный в HTML, он менял бы её каждую
    // секунду, и окно пересобиралось бы под пальцем — нажатие «Отступить», чьи down/up
    // пришлись на разные кадры, терялось бы. Поэтому узел патчится на месте.
    const left = host.view?.timeLeft;
    if (left)
      for (const root of [host.body(), place])
        for (const el of Array.from(root?.querySelectorAll<HTMLElement>('.pn-timer') ?? []))
          el.textContent = el.dataset.at ? left(Number(el.dataset.at)) : '—';
  };
  if (typeof window !== 'undefined')
    window.addEventListener('resize', () => {
      if (isOpen()) draw();
    });
  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const model = shown ? host.model(shown) : null;
    const snapshot = model ?? (summary !== null ? lastModel : null);
    if (tg.closest('[data-battle-expand]')) {
      const key = tg.closest<HTMLElement>('[data-battle-expand]')!.dataset.battleExpand!;
      // До первого нажатия раскрыт состав каждой стороны: набор заводится из всех ключей.
      expanded ??= new Set(snapshot?.sides.map(sideKey) ?? []);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      repaint();
      return;
    }
    for (const [attr, set] of [
      ['battleMore', fullComposition],
      ['battleEffects', effects],
    ] as const) {
      const name = attr.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);
      const key = tg.closest<HTMLElement>(`[data-${name}]`)?.dataset[attr];
      if (key) {
        if (set.has(key)) set.delete(key);
        else set.add(key);
        repaint();
        return;
      }
    }
    if (tg.closest('[data-battle-rules]')) {
      rules = !rules;
      repaint();
      // Правила раскрываются в самом низу окна: без прокрутки была бы видна одна их строка.
      if (rules) host.body().querySelector('.bw-rules')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (tg.closest('[data-battle-sheet-close]')) {
      sheet = null;
      repaint();
      return;
    }
    const lane = tg.closest<HTMLElement>('[data-battle-lane]')?.dataset.battleLane as
      | Lane
      | undefined;
    if (lane) {
      if (openLanes.has(lane)) openLanes.delete(lane);
      else openLanes.add(lane);
      repaint();
      return;
    }
    const pick = tg.closest<HTMLElement>('[data-battle-arrows]')?.dataset.battleArrows;
    if (pick === 'all' || pick === 'mine') {
      arrowsPick = pick;
      repaint();
      return;
    }
    if (tg.closest('[data-battle-replies]')) {
      replies = !replies;
      repaint();
      return;
    }
    const tile = tg.closest<HTMLElement>('[data-battle-side]')?.dataset.battleSide;
    if (tile && snapshot) {
      const side = snapshot.sides.find((s) => sideKey(s) === tile);
      const current = schemeLayout(snapshot, host.view ?? {}, {
        ...options(),
        ended: !model,
      }).sel;
      // Своя живая сторона: первый тап выделяет её (приказы внизу), второй — открывает лист.
      if (side?.mine && sideAlive(side) && model && current !== tile) {
        sel = tile;
        sheet = null;
      } else sheet = sheet === tile ? null : tile;
      repaint();
      return;
    }
    const info = tg.closest<HTMLElement>('[data-battle-info]')?.dataset.battleInfo;
    if (info) {
      sheet = info;
      repaint();
      return;
    }
    if (tg.closest('[data-battle-unselect]')) {
      sel = null;
      sheet = null;
      repaint();
      return;
    }
    if (shown && model) {
      const attack = tg.closest<HTMLElement>('[data-battle-attack]')?.dataset.battleAttack;
      if (
        attack &&
        model.sides.some((s) => s.mine && s.role === 'defender' && sideKey(s) === attack)
      ) {
        host.attack?.(shown, attack);
        repaint();
        return;
      }
      if (
        tg.closest('[data-battle-attack-all]') &&
        model.sides.some((s) => s.mine && s.role === 'defender')
      ) {
        host.attack?.(shown);
        repaint();
        return;
      }
      if (
        tg.closest('[data-battle-retreat-all]') &&
        battleRetreats(host.state(), shown, host.me()).length
      ) {
        host.retreatAll?.(shown);
        return;
      }
    }
    const fleet = tg.closest<HTMLElement>('[data-battle-retreat]')?.dataset.battleRetreat;
    if (fleet && shown && model && battleRetreats(host.state(), shown, host.me()).includes(fleet)) {
      host.retreat(fleet);
      repaint();
      return;
    }
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      host.root().classList.remove('show');
      host.root().classList.remove('has-sheet');
      // Лист живёт в своём узле: без очистки он пережил бы окно и встал поверх нового боя.
      const place = sheetHost();
      if (place) {
        place.innerHTML = '';
        place.hidden = true;
      }
      sheet = null;
      lastSheet = '';
      shown = null;
    }
  });
  return {
    open: (battleId: string): void => {
      if (battleId !== shown) {
        lastModel = null;
        summary = null;
        expanded = undefined;
        fullComposition.clear();
        effects.clear();
        openLanes.clear();
        rules = false;
        sel = undefined;
        sheet = null;
        arrowsPick = 'all';
        replies = true;
      }
      shown = battleId;
      lastHtml = '';
      // Не пустая строка: пустой лист тоже обязан лечь в свой узел при новом открытии.
      lastSheet = '\u0000';
      lastHead = '';
      host.root().classList.add('show');
      repaint();
    },
    ended: (battleId: string, text: string): void => {
      if (battleId !== shown) return;
      summary = text;
      repaint();
    },
    repaint,
    isOpen,
  };
}

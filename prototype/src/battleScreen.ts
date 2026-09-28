/**
 * ОКНО БОЯ — кто дерётся за этот узел и какими силами (заказ владельца 2026-09-15).
 *
 * До него расклад боя можно было увидеть ровно одним путём: выделить СВОЙ флот, который
 * в этом бою стоит. То есть про чужую схватку рядом узнать было нечем, а про свою
 * приходилось сперва попасть пальцем по кораблю — и это в игре, где значок боя на карте
 * уже висит и уже показывает отсчёт до следующего раунда.
 *
 * Окно открывается тапом по этому значку (`decisions/battleTap.ts`) и показывает то, чего
 * карточка флота показать не могла: ВСЕ стороны разом, с ролями и силами. Именно это стало
 * возможным после MSB-6 — модель панели (`createBattleModel`) отдаёт `sides` списком, а не
 * парой «атакующий/обороняющийся».
 *
 * Форма та же, что у остальных REFM-экранов: всё, что только считает и верстает, — чистая
 * экспортируемая функция (проверяется без DOM), а `initBattleWindow(host)` берёт
 * зависимости явно.
 *
 * 1. **Ролю берём У СТОРОНЫ, а не из места в списке.** Атакующих может быть несколько
 *    (MSB-3/MSB-4), и порядок о роли не говорит ничего.
 * 2. **Своя сторона помечена.** В свалке на пять сторон «где я» — первый вопрос игрока, и
 *    искать себя по имени владельца в списке одинаковых строк было бы мучением.
 * 3. **Прогноза здесь НЕТ, и это решение.** Окно отвечает на вопрос «кто и какими силами»,
 *    а не «чем кончится»: у многостороннего боя исход честно не определён, пока выживших
 *    может остаться несколько, и показать там одно число значило бы соврать. Прогноз живёт
 *    в карточке штурма, где сторон ровно две и ответ существует.
 * 4. **Пустое окно не открывается молча.** Бой мог кончиться, пока палец летел к экрану;
 *    честная строка лучше пустой рамки.
 */
import { t } from '../../localization/runtime';
import { esc, displayUnit, kfmt, runClockShown } from './format';
import { runRealSeconds } from '../../decisions/runClock';
import { hullTone, meterShare, powerShares } from '../../decisions/battleBalance';
import { veteranBadge } from '../../decisions/veteranBadge';
import { combatantKey, landingBattleOf } from '../../packages/shared-core/src/state/battle';
import { safeHexColor, COLOR } from './sideColors';
import type { GameState, PlayerId } from '../../packages/shared-core/src/index';
import type { BattleModel } from '../../packages/client/src/matchHud';

/** Что окну нужно от хоста — ровно и только это. */
export interface BattleWindowHost {
  root: () => HTMLElement;
  body: () => HTMLElement;
  /** Заголовок в шапке окна — туда пишется {@link battleHeadHtml}. Нет узла — шапка
   *  остаётся той, что в разметке. */
  head?: () => HTMLElement | null;
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

/** Как хост называет и красит то, что окно показывает. */
export interface BattleView {
  /** The same unit tile renderer used by fleet and garrison cards. */
  tiles?: (side: Side, limit: number, color: string) => string;
  ownerName?: (owner: string | null) => string;
  /** Цвет владельца — тот же, что у его флотов и границ на карте. */
  color?: (owner: string | null) => string;
  /** Позывной флота вместо сырого id. */
  fleetName?: (fleetId: string) => string;
  /** Имя мира, за который бой. */
  placeName?: (planetId: string) => string;
  /** Порог авто-отхода флота (доля корпуса) или null — приказа нет. */
  autoRetreatAt?: (fleetId: string) => number | null;
  /** Остаток до отметки времени мира — текст отсчёта до следующего раунда. */
  timeLeft?: (at: number) => string;
}

type Side = BattleModel['sides'][number];

const NEUTRAL = '#8aa0ad';

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
}

function sideKey(side: Side): string {
  return side.key ?? (side.ref ? combatantKey(side.ref) : `${side.kind}:${side.owner}`);
}

function sideColor(side: Side, view: BattleView): string {
  if (side.mine) return safeHexColor(view.color?.(side.owner), COLOR.p1!);
  if (side.relation === 'ally') return COLOR.ally!;
  return safeHexColor(view.color?.(side.owner), side.relation === 'neutral' ? NEUTRAL : '#ff5a4d');
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

/** Hull, shield, damage, effects and commands stay visible when tiles are folded. */
export function sideRowHtml(
  side: Side,
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  const key = sideKey(side);
  const expanded = options.expanded?.has(key) ?? true;
  const count = (side.stacks ?? side.units).filter((u) => u.count > 0).length;
  const full = options.fullComposition?.has(key) ?? false;
  const ref = side.ref;
  const fleetId = ref && (ref.kind === 'fleet' || ref.kind === 'landing') ? ref.fleetId : undefined;
  const kind =
    side.kind === 'garrison'
      ? t('side.battle.side.garrison')
      : side.kind === 'landing'
        ? t('side.battle.side.landing')
        : side.kind === 'beachhead'
          ? t('battle.win.beachhead')
          : t('side.battle.side.fleet');
  const name = fleetId ? (view.fleetName?.(fleetId) ?? fleetId) : kind;
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
  const canRetreat = fleetId && options.retreats?.includes(fleetId);
  const autoAt = fleetId ? view.autoRetreatAt?.(fleetId) : undefined;
  return (
    `<article class="bw-side${side.mine ? ' mine' : ''} ${side.role}" style="--own:${esc(col)}">` +
    `<div class="bw-who"><div><b>${esc(name)}</b><small>${esc(side.ownerName)} · ${esc(kind)}</small></div>` +
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
    effectsHtml(side, view, options.effects?.has(key) ?? false) +
    `<button class="bw-expand" data-battle-expand="${esc(key)}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${esc(t('battle.win.composition', { n: count }))}</button>` +
    (expanded
      ? `<div class="ptiles bw-tiles">${tiles}</div>` +
        (count > 16
          ? `<button class="bw-more" data-battle-more="${esc(key)}">${esc(full ? t('battle.win.less') : t('battle.win.more', { n: count - 16 }))}</button>`
          : '')
      : '') +
    (side.mine && !options.ended
      ? `<div class="bw-actions">` +
        `<button class="b bw-attack" data-battle-attack="${esc(key)}"${side.role === 'attacker' ? ' disabled' : ''}>${esc(t(side.role === 'attacker' ? 'battle.win.attacking' : 'battle.win.attack'))}</button>` +
        `<button class="b" data-battle-retreat="${esc(fleetId ?? '')}"${canRetreat ? '' : ' disabled'}>${esc(t('side.battle.retreat'))}</button></div>` +
        (fleetId && autoAt !== undefined
          ? `<p class="bw-auto">${esc(autoAt === null ? t('battle.win.auto.off') : t('battle.win.auto.on', { n: Math.round(autoAt * 100) }))}</p>`
          : '')
      : '') +
    `</article>`
  );
}

/** Полоса «запас прочности»: доли сторон цветами владельцев. Меньше двух долей — нет. */
function balanceHtml(sides: readonly Side[], view: BattleView): string {
  const shares = powerShares(sides);
  if (shares.length < 2) return '';
  const col = (s: Side): string => esc(view.color?.(s.owner) ?? NEUTRAL);
  return (
    `<div class="bw-balance"><p class="bw-sub">${esc(t('battle.win.balance'))}</p><div class="bw-bal">` +
    sides
      .map((s, i) => `<i style="flex:${(shares[i] ?? 0).toFixed(4)};background:${col(s)}"></i>`)
      .join('') +
    `</div><div class="bw-legend">` +
    sides
      .map(
        (s, i) =>
          `<span${s.mine ? ' class="mine"' : ''}><i style="background:${col(s)}"></i>${esc(s.ownerName)} ${Math.round((shares[i] ?? 0) * 100)}%</span>`,
      )
      .join('') +
    `</div></div>`
  );
}

/**
 * Шапка окна: где бой, фаза и сколько сторон (заказ владельца 2026-09-28). Раньше то же
 * самое стояло отдельной карточкой над полосой сил и съедало её высоту, хотя в шапке
 * рядом с «Бой» место и так было. Нет модели — просто «Бой».
 */
export function battleHeadHtml(m: BattleModel | null, view: BattleView = {}): string {
  if (!m) return `<b>${esc(t('battle.win.head'))}</b>`;
  const ground = m.phase === 'ground';
  return (
    `<b>${esc(t('battle.win.at', { w: view.placeName?.(m.location) ?? m.location }))}</b>` +
    `<span class="bw-phase${ground ? ' ground' : ''}">${esc(t(ground ? 'battle.win.phase.ground' : 'battle.win.phase.orbit'))} · ${esc(t('battle.win.sides', { n: m.sides.length }))}</span>`
  );
}

/** Two visual columns only: diplomacy and attack targets stay per participant. */
export function battleWindowHtml(
  m: BattleModel | null,
  retreats: readonly string[] = [],
  view: BattleView = {},
  options: BattleWindowOptions = {},
): string {
  if (!m) return `<p class="bw-empty">${esc(t('battle.win.empty'))}</p>`;
  const ground = m.phase === 'ground';
  const friends = m.sides.filter((s) => s.mine || s.relation === 'ally');
  const others = m.sides.filter((s) => !s.mine && s.relation !== 'ally');
  const expanded =
    options.expanded ?? new Set([friends[0], others[0]].filter((s): s is Side => !!s).map(sideKey));
  const renderColumn = (sides: Side[], title: string): string =>
    `<section class="bw-column"><h3>${esc(title)} <span>${sides.length}</span></h3>` +
    sides.map((s) => sideRowHtml(s, view, { ...options, expanded, retreats })).join('') +
    '</section>';
  const canAttack = m.sides.some((s) => s.mine && s.role === 'defender');
  return (
    balanceHtml(m.sides, {
      ...view,
      color: (owner) =>
        sideColor(
          m.sides.find((s) => s.owner === owner)!,
          view,
        ),
    }) +
    `<div class="bw-columns">${renderColumn(friends, t('battle.win.allies'))}${renderColumn(others, t('battle.win.opponents'))}</div>` +
    (!options.ended && m.sides.some((s) => s.mine)
      ? `<div class="bw-orders"><button class="b bw-attack" data-battle-attack-all${canAttack ? '' : ' disabled'}>${esc(t('battle.win.attack-all'))}</button>` +
        `<button class="b" data-battle-retreat-all${retreats.length ? '' : ' disabled'}>${esc(t('battle.win.retreat-all'))}</button></div>` +
        `<p class="hint">${esc(t(ground ? 'battle.win.ground-retreat' : 'side.battle.retreat.hint'))}</p>`
      : '') +
    `<p class="bw-rule">${esc(runClockShown() ? t('battle.win.rule.run', { n: runRealSeconds(3_600_000) }) : t('battle.win.rule'))}</p>`
  );
}

/** Current membership, never the unrelated fleet selected behind the window. */
/**
 * Бой кончился, пока окно открыто (решение владельца 2026-09-25): итог строкой журнала и
 * последний снимок сторон под ним — до закрытия, а не «об этом бое ничего не известно».
 * Отсчёта раунда и кнопок отхода нет: раундов больше не будет, отходить не из чего.
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
  let lastHead = '';
  let expanded: Set<string> | undefined;
  const fullComposition = new Set<string>();
  const effects = new Set<string>();
  const repaint = (): void => {
    if (!isOpen() || shown === null) return;
    const model = host.model(shown);
    if (model) {
      lastModel = model;
      expanded ??= new Set(
        [
          model.sides.find((s) => s.mine || s.relation === 'ally'),
          model.sides.find((s) => !s.mine && s.relation !== 'ally'),
        ]
          .filter((s): s is Side => !!s)
          .map(sideKey),
      );
    }
    const options = { expanded, fullComposition, effects };
    const html =
      !model && summary !== null
        ? battleEndedHtml(lastModel, summary, host.view, options)
        : battleWindowHtml(
            model,
            model ? battleRetreats(host.state(), shown, host.me()) : [],
            host.view,
            options,
          );
    if (html !== lastHtml) {
      const scroll = host.body().scrollTop;
      host.body().innerHTML = html;
      host.body().scrollTop = scroll;
      lastHtml = html;
    }
    // Шапка — по тому же снимку, что и тело: кончившийся бой держит в ней своё место.
    const head = battleHeadHtml(model ?? (summary !== null ? lastModel : null), host.view);
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
      for (const el of Array.from(host.body().querySelectorAll<HTMLElement>('.pn-timer')))
        el.textContent = el.dataset.at ? left(Number(el.dataset.at)) : '—';
  };
  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    for (const [attr, set] of [
      ['battleExpand', expanded],
      ['battleMore', fullComposition],
      ['battleEffects', effects],
    ] as const) {
      const name = attr.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);
      const key = tg.closest<HTMLElement>(`[data-${name}]`)?.dataset[attr];
      if (key && set) {
        if (set.has(key)) set.delete(key);
        else set.add(key);
        repaint();
        return;
      }
    }
    if (shown && host.model(shown)) {
      const model = host.model(shown)!;
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
    if (
      fleet &&
      shown &&
      host.model(shown) &&
      battleRetreats(host.state(), shown, host.me()).includes(fleet)
    ) {
      host.retreat(fleet);
      repaint();
      return;
    }
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      host.root().classList.remove('show');
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
      }
      shown = battleId;
      lastHtml = '';
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

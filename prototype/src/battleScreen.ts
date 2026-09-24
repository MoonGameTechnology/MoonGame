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
import { esc, displayUnit, runClockShown } from './format';
import { runRealSeconds } from '../../decisions/runClock';
import { hullTone, meterShare, powerShares } from '../../decisions/battleBalance';
import { veteranBadge } from '../../decisions/veteranBadge';
import type { GameState, PlayerId } from '../../packages/shared-core/src/index';
import type { BattleModel } from '../../packages/client/src/matchHud';

/** Что окну нужно от хоста — ровно и только это. */
export interface BattleWindowHost {
  root: () => HTMLElement;
  body: () => HTMLElement;
  state: () => GameState;
  me: () => PlayerId;
  /** Модель боя (из `@void/client`), либо null — бой исчез или под туманом. */
  model: (battleId: string) => BattleModel | null;
  retreat: (fleetId: string) => void;
  /** Оформление (заказ владельца 2026-09-23) — всё необязательно: без него окно честно
   *  рисуется нейтральным цветом, сырым id и без строки авто-отхода. */
  view?: BattleView;
}

/** Как хост называет и красит то, что окно показывает. */
export interface BattleView {
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

/** Одна карточка стороны: кто, в какой роли, чем держит узел и сколько осталось. */
export function sideRowHtml(side: Side, view: BattleView = {}): string {
  const kind =
    side.kind === 'garrison'
      ? t('side.battle.side.garrison')
      : side.kind === 'landing'
        ? t('side.battle.side.landing')
        : side.kind === 'beachhead'
          ? t('battle.win.beachhead')
          : t('side.battle.side.fleet');
  const role = t(
    side.role === 'attacker' ? 'battle.win.role.attacker' : 'battle.win.role.defender',
  );
  const tone = side.hull ? hullTone(side.hull.current, side.hull.max) : 'ok';
  const col = view.color?.(side.owner) ?? NEUTRAL;
  const units =
    side.units
      .map((u) => `<span class="bw-unit"><b>${u.count}×</b> ${esc(displayUnit(u.unit))}</span>`)
      .join('') || '<span class="bw-unit">—</span>';
  // PERK-3.3: надбавка за пережитые бои. Решение «что показать и когда молчать» —
  // в `/decisions/veteranBadge.ts`, здесь только подстановка. Значка нет у сил без
  // выслуги, поэтому у необстрелянной стороны строка не меняется ни на символ.
  const vet = veteranBadge(side.veteran);
  const vetHtml = vet
    ? `<span class="bw-vet" title="${esc(vet.title)}" aria-label="${esc(vet.title)}">${vet.glyph}${esc(vet.text)}</span>`
    : '';
  return (
    `<div class="bw-side${side.mine ? ' mine' : ''} ${side.role}" style="--own:${esc(col)}">` +
    `<p class="bw-who"><b>${esc(side.ownerName)}</b>` +
    (side.mine ? `<em class="bw-you">${esc(t('battle.win.you'))}</em>` : '') +
    `<span class="bw-role">${esc(role)}</span><span class="bw-kind">${esc(kind)}</span>${vetHtml}</p>` +
    meter(side.hull, `hull tone-${tone}`, t('battle.win.hull'), t(TONE_KEY[tone])) +
    meter(side.shield, 'shield', t('battle.win.shield')) +
    `<div class="bw-units">${units}</div>` +
    `</div>`
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

/** Тело окна целиком. */
export function battleWindowHtml(
  m: BattleModel | null,
  retreats: readonly string[] = [],
  view: BattleView = {},
): string {
  if (!m) return `<p class="bw-empty">${esc(t('battle.win.empty'))}</p>`; // правило 4
  const ground = m.phase === 'ground';
  const phase = t(ground ? 'battle.win.phase.ground' : 'battle.win.phase.orbit');
  const place = view.placeName?.(m.location) ?? m.location;
  return (
    `<div class="bw-top ${ground ? 'ground' : 'orbit'}">` +
    `<span class="bw-ico">${ground ? '🪐' : '🛰️'}</span>` +
    `<div class="bw-title"><b>${esc(t('battle.win.at', { w: place }))}</b>` +
    `<p class="bw-head">${esc(phase)} · ${esc(t('battle.win.round', { r: m.round }))}` +
    ` · ${esc(t('battle.win.sides', { n: m.sides.length }))}</p></div>` +
    (m.nextRoundAt != null
      ? `<div class="bw-next"><span>${esc(t('battle.win.next'))}</span><b class="pn-timer" data-at="${m.nextRoundAt}">…</b></div>`
      : '') +
    `</div>` +
    balanceHtml(m.sides, view) +
    `<div class="bw-sides">${m.sides.map((sd) => sideRowHtml(sd, view)).join('')}</div>` +
    (retreats.length
      ? `<div class="bw-orders"><p class="bw-sub">${esc(t('battle.win.yours'))}</p>${retreats
          .map((id) => {
            const at = view.autoRetreatAt?.(id) ?? null;
            const auto =
              at === null
                ? t('battle.win.auto.off')
                : t('battle.win.auto.on', { n: Math.round(at * 100) });
            return (
              `<div class="bw-ret"><div><b>${esc(view.fleetName?.(id) ?? id)}</b><span>${esc(auto)}</span></div>` +
              `<button class="b" data-battle-retreat="${esc(id)}">${esc(t('side.battle.retreat'))}</button></div>`
            );
          })
          .join('')}</div><p class="hint">${esc(t('side.battle.retreat.hint'))}</p>`
      : '') +
    // Раунд — игровой час (`combat.ts`); в забеге он называется реальными секундами.
    `<p class="bw-rule">${esc(runClockShown() ? t('battle.win.rule.run', { n: runRealSeconds(3_600_000) }) : t('battle.win.rule'))}</p>`
  );
}

/** Current membership, never the unrelated fleet selected behind the window. */
export function battleRetreats(state: GameState, id: string, me: PlayerId): string[] {
  return (state.battles[id]?.sides ?? []).flatMap((side) =>
    side.ref.kind === 'fleet' &&
    side.owner === me &&
    state.fleets[side.ref.fleetId]?.owner === me &&
    state.fleets[side.ref.fleetId]?.battleId === id
      ? [side.ref.fleetId]
      : [],
  );
}

export function initBattleWindow(host: BattleWindowHost): {
  open: (battleId: string) => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let shown: string | null = null;
  const isOpen = (): boolean => host.root().classList.contains('show');
  let lastHtml = '';
  const repaint = (): void => {
    if (!isOpen() || shown === null) return;
    const model = host.model(shown);
    const html = battleWindowHtml(
      model,
      model ? battleRetreats(host.state(), shown, host.me()) : [],
      host.view,
    );
    if (html !== lastHtml) {
      const scroll = host.body().scrollTop;
      host.body().innerHTML = html;
      host.body().scrollTop = scroll;
      lastHtml = html;
    }
    // Отсчёт живёт ВНЕ подписи разметки: вписанный в HTML, он менял бы её каждую
    // секунду, и окно пересобиралось бы под пальцем — нажатие «Отступить», чьи down/up
    // пришлись на разные кадры, терялось бы. Поэтому узел патчится на месте.
    const left = host.view?.timeLeft;
    if (left)
      for (const el of Array.from(host.body().querySelectorAll<HTMLElement>('.pn-timer')))
        el.textContent = left(Number(el.dataset.at));
  };
  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
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
      shown = battleId;
      lastHtml = '';
      host.root().classList.add('show');
      repaint();
    },
    repaint,
    isOpen,
  };
}

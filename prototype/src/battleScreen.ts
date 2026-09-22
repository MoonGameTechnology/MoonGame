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
import { esc, displayUnit } from './format';
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
}

const bar = (v: { current: number; max: number } | undefined, label: string): string =>
  v && v.max > 0
    ? `<span class="bw-bar">${esc(label)} ${Math.round(v.current)}/${Math.round(v.max)}</span>`
    : '';

/** Одна строка стороны: кто, в какой роли, чем держит узел. */
export function sideRowHtml(side: BattleModel['sides'][number]): string {
  const kind =
    side.kind === 'garrison'
      ? t('side.battle.side.garrison')
      : side.kind === 'landing'
        ? t('side.battle.side.landing')
        : side.kind === 'beachhead'
          ? t('battle.win.beachhead')
          : t('side.battle.side.fleet');
  const role = t(side.role === 'attacker' ? 'side.battle.attacker' : 'side.battle.defender');
  const troops = side.units.map((u) => `${u.count}× ${esc(displayUnit(u.unit))}`).join(', ') || '—';
  return (
    `<div class="bw-side${side.mine ? ' mine' : ''} ${side.role}">` +
    `<p class="bw-who">${side.mine ? '▶ ' : ''}<b>${esc(side.ownerName)}</b>` +
    ` <i>${esc(role)}</i> <span class="dim">${esc(kind)}</span></p>` +
    `<p class="bw-force">${troops} ${bar(side.hull, t('battle.win.hull'))}${bar(side.shield, t('battle.win.shield'))}</p>` +
    `</div>`
  );
}

/** Тело окна целиком. */
export function battleWindowHtml(m: BattleModel | null, retreats: readonly string[] = []): string {
  if (!m) return `<p class="bw-empty">${esc(t('battle.win.empty'))}</p>`; // правило 4
  const phase = t(m.phase === 'ground' ? 'battle.win.phase.ground' : 'battle.win.phase.orbit');
  return (
    `<p class="bw-head">${esc(phase)} · ${esc(t('battle.win.round', { r: m.round }))}` +
    ` · ${esc(t('battle.win.sides', { n: m.sides.length }))}</p>` +
    (m.nextRoundAt != null
      ? `<p class="bw-next">${esc(t('battle.win.next'))} <span class="pn-timer" data-at="${m.nextRoundAt}">…</span></p>`
      : '') +
    `<div class="bw-sides">${m.sides.map(sideRowHtml).join('')}</div>` +
    (retreats.length
      ? `<div class="bw-orders">${retreats
          .map(
            (id) =>
              `<button class="b" data-battle-retreat="${esc(id)}">${esc(t('side.battle.retreat'))} · ${esc(id)}</button>`,
          )
          .join('')}</div><p class="hint">${esc(t('side.battle.retreat.hint'))}</p>`
      : '')
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
    );
    if (html !== lastHtml) {
      const scroll = host.body().scrollTop;
      host.body().innerHTML = html;
      host.body().scrollTop = scroll;
      lastHtml = html;
    }
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

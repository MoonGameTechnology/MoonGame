/**
 * Экран итогов матча — исход, цифры и «что дальше» (REFM-20).
 *
 * Числа берутся из АВТОРИТЕТНОГО `state.match`, поэтому одна и та же панель обслуживает
 * и соло, и сетевой матч: клиент ничего не досчитывает за сервер.
 *
 * Две тонкости, ради которых панель не так проста, как выглядит:
 *  — её НЕ показывают поверх хаба. Игрок вышел в меню, мир (в сети) продолжает идти, матч
 *    может закончиться — и «Победа!» над меню была бы ложным срабатыванием (BF-29). Панель
 *    возвращается, когда игрок возвращается в матч.
 *  — «Ещё раз» честно разное по режимам: соло перезапускает схватку, а сетевой матч
 *    пересобрать за тем же столом клиент не может (нужна серверная опора), поэтому там
 *    открывается браузер матчей.
 *
 * Форма REFM: разметка и подсчёт места чистые (`endScreenHtml`, `placementOf`), уход из
 * матча — дело хоста (сеть, туры, хаб), модуль только сообщает, что выбрал игрок.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Что игрок выбрал на панели: сыграть ещё или уйти в меню. */
export type EndAction = 'again' | 'menu';

/** Итог матча глазами клиента — его ставит `checkEnd`. */
export interface MatchEnd {
  won: boolean;
  draw: boolean;
  /** Человеческая причина конца («набран порог очков», «соперники уничтожены»). */
  why: string;
  xp: number;
  levelUp: number | null;
  /** Игрок закрыл панель, чтобы посмотреть на замерший стол. */
  dismissed?: boolean;
}

/** Место среди всех, у кого есть счёт: 1-е из N, плюс собственный итог. Пустая таблица —
 *  место 0 из 0, а не «первый из ниоткуда». */
export function placementOf(
  scores: Record<string, { total?: number } | undefined>,
  me: string,
): { place: number; of: number; total: number } {
  const ranked = Object.keys(scores).sort(
    (a, b) => (scores[b]?.total ?? 0) - (scores[a]?.total ?? 0),
  );
  return {
    place: ranked.indexOf(me) + 1,
    of: ranked.length,
    total: Math.round(scores[me]?.total ?? 0),
  };
}

/** Заголовок исхода. Победа коалицией названа отдельно — это другой сюжет, чем победа
 *  в одиночку, и игрок должен видеть, что титул общий. */
export function outcomeTitle(end: MatchEnd, winners: readonly string[] | undefined): string {
  if (end.won) return winners && winners.length > 1 ? t('end.win.coalition') : t('end.win');
  return end.draw ? t('end.draw') : t('end.loss');
}

/** Панель целиком. Чистая: всё, что нужно, приходит аргументами. */
export function endScreenHtml(
  state: GameState,
  me: string,
  end: MatchEnd,
  view: {
    net: boolean;
    /** Провинции, если счёт их не несёт (старый матч без снимка). */
    worldsFallback: number;
    fmtStamp: (at: number, opts?: { day?: boolean; time?: boolean }) => string;
  },
): string {
  const sc = state.match?.scores ?? {};
  const mine = sc[me];
  const { place, of, total } = placementOf(sc, me);
  const provinces = mine?.controlledPlanets ?? view.worldsFallback;
  const fleets = mine?.fleets ?? 0;
  const units = mine?.units ?? 0;
  const elapsed = Math.max(0, (state.match?.endedAt ?? state.time) - (state.startedAt ?? 0));
  const dur = view.fmtStamp(elapsed, { day: true, time: true });
  const cls = end.won ? 'win' : end.draw ? 'draw' : 'lose';
  const head = outcomeTitle(end, state.match?.winners);
  const cell = (k: string, v: string): string =>
    `<div class="es-cell"><span class="es-k">${k}</span><span class="es-v">${v}</span></div>`;
  const xpLine =
    end.xp > 0
      ? `<div class="es-xp">${t('end.xp', { n: end.xp })}` +
        (end.levelUp !== null
          ? `<span class="lvl">${t('end.level-up', { lvl: end.levelUp })}</span>`
          : '') +
        `</div>`
      : '';
  // Формулировка «ещё раз» честна по режиму: соло перезапускает схватку, сеть — открывает
  // браузер матчей (пересадить тот же стол клиент не может).
  const againLabel = view.net ? t('end.new-match') : t('end.play-again');
  return (
    `<div class="es-box">` +
    `<div class="es-head ${cls}">${head}</div>` +
    `<div class="es-why">${esc(end.why)}</div>` +
    `<div class="es-grid">` +
    `<div class="es-cell wide"><span class="es-k">${t('end.score')}</span><span class="es-v">✦ ${total} <small>· ${t('end.place', { p: place, n: of })}</small></span></div>` +
    cell(t('end.provinces'), `⬣ ${provinces}`) +
    cell(t('end.fleets'), `⛴ ${fleets}`) +
    cell(t('end.units'), `⚔ ${units}`) +
    cell(t('end.duration'), dur) +
    `</div>` +
    xpLine +
    `<div class="es-acts">` +
    `<button class="es-btn primary" data-es="again">${againLabel}</button>` +
    `<button class="es-btn" data-es="menu">⌂ ${t('end.to-menu')}</button>` +
    `<button class="es-btn ghost" data-es="board">${t('end.board')}</button>` +
    `</div></div>`
  );
}

/** Что панель берёт у экрана матча. */
export interface EndScreenHost {
  /** Оверлей (`#endscreen`). */
  root(): HTMLElement;
  /** Состояние матча — числа читаются из него, а не досчитываются. */
  state(): GameState;
  me(): string;
  /** Итог матча, или `null` пока матч идёт. */
  end(): MatchEnd | null;
  /** Игрок нажал «посмотреть стол» — панель прячется, итог остаётся. */
  dismiss(): void;
  /** Игрок уходит — итог сбрасывается, чтобы не всплыть над хабом. */
  clearEnd(): void;
  /** Открыт ли хаб: поверх него панель не показывают (BF-29). */
  hubVisible(): boolean;
  net(): boolean;
  /** Провинции, если в счёте их нет. */
  worldsFallback(): number;
  fmtStamp(at: number, opts?: { day?: boolean; time?: boolean }): string;
  /** Уход из матча — сеть, туры и хаб принадлежат хосту. */
  onLeave(which: EndAction, wasNet: boolean): void;
}

/** Собрать панель. `render()` зовётся каждым кадром — она сама решает, показываться ли. */
export function initEndScreen(host: EndScreenHost): { render: () => void } {
  let lastHtml = ''; // кадр за кадром одна и та же разметка — не трогаем DOM зря

  const hide = (): void => {
    const root = host.root();
    if (root.style.display !== 'none') {
      root.style.display = 'none';
      lastHtml = '';
    }
  };

  function render(): void {
    // Поверх хаба не показываем: игрок ушёл в меню, а мир (в сети) идёт дальше — «Победа!»
    // над меню была бы ложным срабатыванием.
    if (host.hubVisible()) return hide();
    const end = host.end();
    if (!end || end.dismissed) return hide();
    const html = endScreenHtml(host.state(), host.me(), end, {
      net: host.net(),
      worldsFallback: host.worldsFallback(),
      fmtStamp: host.fmtStamp,
    });
    const root = host.root();
    if (html !== lastHtml) {
      root.innerHTML = html;
      lastHtml = html;
    }
    root.style.display = 'flex';
  }

  host.root().addEventListener('click', (ev) => {
    const act = (ev.target as Element).closest('[data-es]') as HTMLElement | null;
    if (!act) return;
    const which = act.dataset.es;
    if (which === 'board') {
      host.dismiss(); // спрятать панель, оставить замерший стол
      return;
    }
    const wasNet = host.net();
    host.clearEnd(); // уходим из законченного матча — итог не должен всплыть над хабом
    lastHtml = '';
    host.onLeave(which === 'again' ? 'again' : 'menu', wasNet);
  });

  return { render };
}

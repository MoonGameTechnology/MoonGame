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
import { missionLabelN } from '../../decisions/missionView';
import type { GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc } from './format';
import type { RunSummary } from '../../decisions/sectorZeroProgress';
import { adRefusalKey, type AdOutcome, type AdPlacement } from '../../decisions/adPlacements';

/** Что игрок выбрал на панели: сыграть ещё или уйти в меню. */
/** `replay` — новая попытка той же главы Sector Zero, мимо меню (итоги забега). */
export type EndAction = 'again' | 'menu' | 'replay';

/** Итог матча глазами клиента — его ставит `checkEnd`. */
export interface MatchEnd {
  won: boolean;
  draw: boolean;
  /** Человеческая причина конца («набран порог очков», «соперники уничтожены»). */
  why: string;
  xp: number;
  levelUp: number | null;
  /** Persistent expedition data, separate from commander XP. */
  runReward?: number;
  /** Разбивка засчитанного забега Sector Zero (PVR-5.4). Нет — показывается одна сумма. */
  runSummary?: RunSummary;
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
    /** ×2 к награде забега за ролик: сколько придёт сверху (`EndScreenDouble.offer`). */
    double?: { research: number; warrants: number } | null;
    /** Итог нажатия ×2 — удвоено или почему нет. */
    note?: string;
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
  const xpLine = end.runSummary
    ? runSummaryHtml(end.runSummary)
    : end.runReward !== undefined
      ? `<div class="es-xp">${t('sector-zero.end.reward', { n: end.runReward })}</div>`
      : end.xp > 0
        ? `<div class="es-xp">${t('end.xp', { n: end.xp })}` +
          (end.levelUp !== null
            ? `<span class="lvl">${t('end.level-up', { lvl: end.levelUp })}</span>`
            : '') +
          `</div>`
        : '';
  // ×2 (`run.double`) — сразу под наградой, которую удваивает, и только под разбивкой
  // ЭТОГО забега: без неё удвоилась бы награда прошлого. Кнопка называет и ролик, и сколько
  // придёт (п. 4.5.1).
  const double =
    end.runSummary && view.double
      ? `<button class="es-btn ad" data-es="double">${t('sector-zero.prep.double', { n: view.double.research, m: view.double.warrants })}</button>`
      : '';
  const note = view.note ? `<p class="es-note" role="status">${esc(view.note)}</p>` : '';
  // Формулировка «ещё раз» честна по режиму: соло перезапускает схватку, сеть — открывает
  // браузер матчей (пересадить тот же стол клиент не может).
  const againLabel = end.runReward !== undefined ? t('sector-zero.end.prepare') : view.net ? t('end.new-match') : t('end.play-again');
  return (
    `<div class="es-box">` +
    `<div class="es-head ${cls}">${head}</div>` +
    `<div class="es-why">${esc(end.why)}</div>` +
    `<div class="es-grid">` +
    // Счёт и место — не про забег Sector Zero (решение владельца 2026-09-24): победа в нём —
    // выстоять волны, а место среди ИИ-соседей ничего не значит.
    (end.runReward !== undefined
      ? ''
      : `<div class="es-cell wide"><span class="es-k">${t('end.score')}</span><span class="es-v">✦ ${total} <small>· ${t('end.place', { p: place, n: of })}</small></span></div>`) +
    cell(t('end.provinces'), `⬣ ${provinces}`) +
    cell(t('end.fleets'), `⛴ ${fleets}`) +
    cell(t('end.units'), `⚔ ${units}`) +
    cell(t('end.duration'), dur) +
    `</div>` +
    xpLine +
    double +
    note +
    `<div class="es-acts">` +
    // Повтор главы — только у засчитанного забега Sector Zero: у dev-забега разбивки нет.
    (end.runSummary ? `<button class="es-btn primary wide" data-es="replay">↻ ${t('sector-zero.end.replay')}</button>` : '') +
    // Главная кнопка одна: при повторе главы «подготовка» становится второстепенной.
    `<button class="es-btn${end.runSummary ? '' : ' primary'}" data-es="again">${againLabel}</button>` +
    `<button class="es-btn" data-es="menu">⌂ ${t('end.to-menu')}</button>` +
    `<button class="es-btn ghost" data-es="board">${t('end.board')}</button>` +
    `</div></div>`
  );
}

/**
 * Итог забега по частям (PVR-5.4): сам забег (волны, победа) — отдельной строкой от
 * надбавки за задачи; каждая задача — выполнена или нет и сколько заплатила; медали
 * сохранённых ветеранов (VET-7); внизу — сумма и что откроется к следующему заходу. Одной
 * суммой рост числа задач был бы не виден.
 */
export function runSummaryHtml(r: RunSummary): string {
  const row = (cls: string, label: string, value: string): string =>
    `<li class="${cls}"><span>${label}</span><b>${value}</b></li>`;
  const runPart = r.base - (r.won ? 3 : 0);
  const rows = [
    row('run', t('sector-zero.end.waves', { n: r.waves, m: r.totalWaves }), `+${runPart}`),
    ...(r.won ? [row('run', t('sector-zero.end.victory'), '+3')] : []),
    ...r.objectives.map((o) =>
      row(
        o.complete ? 'task done' : 'task',
        `${o.complete ? '✓' : '✗'} ${esc(t(o.id, { n: missionLabelN(o) }))}`,
        o.complete ? `+${o.paid}` : '—',
      ),
    ),
    // VET-7: медали сохранённых ветеранов. Строки нет, когда платить не за что, — как у
    // победы: «+0» за пустое место игроку ничего не сообщает.
    ...(r.veterans ? [row('run', t('sector-zero.end.veterans'), `+${r.veterans}`)] : []),
  ].join('');
  const next =
    r.unlocked > 0
      ? `<p class="es-next">${t('sector-zero.end.unlocked', { n: r.unlocked })}</p>`
      : '';
  // Добыча для редкости модулей (SZE-5.3): дубли поимённо и чертежи по ступеням.
  const copies = Object.entries(r.loot?.copies ?? {})
    .map(([id, n]) => `${esc(tData(data.modules[id]?.name ?? id))} ×${n}`)
    .join(', ');
  // Жетоны героя (`heroTokens.ts`): одному герою за забег — одной строкой.
  const tokens = Object.entries(r.loot?.heroTokens ?? {})
    .map(
      ([id, n]) =>
        `<p class="es-loot es-tokens">★ ${t('sector-zero.end.tokens', { name: esc(tData(data.heroes[id]?.name ?? id)), n })}</p>`,
    )
    .join('');
  const loot =
    tokens +
    (copies ? `<p class="es-loot">${t('sector-zero.end.copies', { list: copies })}</p>` : '') +
    Object.entries(r.loot?.blueprints ?? {})
      .map(
        ([tier, n]) =>
          `<p class="es-loot es-blueprint r-${esc(tier)}">📐 ${t('sector-zero.end.blueprint', { r: t(`rarity.${tier}`) })}${n > 1 ? ` ×${n}` : ''}</p>`,
      )
      .join('');
  return (
    `<div class="es-run"><ul>${rows}</ul>` +
    `<div class="es-total"><span>${t('sector-zero.end.total')}</span><b>${t('sector-zero.end.reward', { n: r.total })} · +${r.warrants} ⌖</b></div>` +
    `${loot}${next}</div>`
  );
}

/**
 * ×2 к награде забега за ролик (`YAG-3.2`, место `run.double`) — то же предложение, что на
 * экране подготовки: удвоение одно на забег, поэтому две кнопки не дают двух выплат.
 */
export interface EndScreenDouble {
  /** Сколько придёт сверху; `null` — предложения нет (площадка без рекламы, уже удвоено). */
  offer(): { research: number; warrants: number } | null;
  /** Ролик площадки — дверь хоста, та же, что у экрана подготовки. */
  watchAd(placement: AdPlacement): Promise<AdOutcome>;
  /** Начислить удвоение; `false` — удваивать уже нечего. */
  apply(): boolean;
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
  /** ×2 к награде забега; нет — кнопки нет. */
  double?: EndScreenDouble;
}

/** Собрать панель. `render()` зовётся каждым кадром — она сама решает, показываться ли. */
export function initEndScreen(host: EndScreenHost): { render: () => void } {
  let lastHtml = ''; // кадр за кадром одна и та же разметка — не трогаем DOM зря
  /** Итог нажатия ×2 — живёт, пока панель на экране. */
  let note = '';
  /** Ролик ×2 идёт — второй тап второго ролика не зовёт. */
  let watching = false;

  const hide = (): void => {
    const root = host.root();
    if (root.style.display !== 'none') {
      root.style.display = 'none';
      lastHtml = '';
      note = '';
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
      double: host.double?.offer() ?? null,
      note,
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
    // ×2 — не уход: итог остаётся на экране. Ролик зовётся ТОЛЬКО отсюда, по нажатию.
    if (which === 'double') {
      const double = host.double;
      const offer = double?.offer();
      if (!double || !offer || watching) return;
      watching = true;
      note = '';
      const settle = (status: AdOutcome): void => {
        watching = false;
        note =
          status !== 'ok'
            ? t(adRefusalKey(status))
            : double.apply()
              ? t('sector-zero.prep.doubled', { n: offer.research, m: offer.warrants })
              : t('sector-zero.prep.unavailable');
      };
      void double.watchAd('run.double').then(settle, () => settle('unavailable'));
      return;
    }
    const wasNet = host.net();
    host.clearEnd(); // уходим из законченного матча — итог не должен всплыть над хабом
    lastHtml = '';
    host.onLeave(which === 'again' || which === 'replay' ? which : 'menu', wasNet);
  });

  return { render };
}

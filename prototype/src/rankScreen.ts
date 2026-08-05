/**
 * RANK-1 — вкладка «Рейтинги» в хабе: две доски (командиры и корпорации) под общими
 * подвкладками.
 *
 * Тот же раздел труда, что у остальных REFM-экранов: разметка ЧИСТАЯ и проверяется
 * тестом (`boardHtml`, `rankMark`), а хоста трогает только `initRank(host)` через
 * явные хуки.
 *
 * Места считает СЕРВЕР (`leaderboardApi.ts`) — здесь их копии нет. Это не формальность:
 * своё место считается по ВСЕЙ популяции, а не по присланной странице, поэтому клиент
 * его вывести и не смог бы. Экран только рисует то, что прислали.
 *
 * Два честных «нет данных», которые легко было бы соврать:
 *  · `rank === null` — «нет места» (ни одного доигранного матча), а НЕ последнее место;
 *  · моя строка вне страницы — она прикрепляется внизу отдельно, с настоящим номером,
 *    вместо того чтобы притвориться, будто меня в рейтинге нет.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  /** Численность — только у доски корпораций. */
  members?: number;
  /** Своя строка — подсвечивается на СВОЁМ месте, не поднимается наверх. */
  me?: boolean;
}

export interface BoardView {
  rows: BoardRow[];
  me: { rank: number | null; score: number; name: string | null };
  total: number;
}

export type BoardKind = 'players' | 'corps';

export const EMPTY_BOARD: BoardView = {
  rows: [],
  me: { rank: null, score: 0, name: null },
  total: 0,
};

/** «1» → медаль, дальше — номер. Тройка призёров читается с одного взгляда. */
export function rankMark(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
}

function rowHtml(r: BoardRow, kind: BoardKind, pinned = false): string {
  const sub =
    kind === 'corps' && r.members !== undefined ? t('rank.members', { n: r.members }) : '';
  return (
    `<div class="rk-row${r.me ? ' me' : ''}${pinned ? ' pin' : ''}">` +
    `<i class="rk-n${r.rank <= 3 ? ' top' : ''}">${rankMark(r.rank)}</i>` +
    `<span class="rk-txt"><b>${esc(r.name)}</b>${sub ? `<span>${sub}</span>` : ''}</span>` +
    `<span class="rk-sc">${r.score}<i>${t(kind === 'corps' ? 'rank.unit.influence' : 'rank.unit.xp')}</i></span>` +
    `</div>`
  );
}

/**
 * Тело вкладки. `signedIn === false` — не «пустой рейтинг», а другое состояние:
 * доска знает своё место только у аккаунта, поэтому гостю показывается причина.
 */
export function boardHtml(
  kind: BoardKind,
  view: BoardView,
  opts: { signedIn: boolean } = { signedIn: true },
): string {
  const tabs =
    `<div class="rk-tabs">` +
    (['players', 'corps'] as const)
      .map(
        (k) =>
          `<button class="rk-tab${k === kind ? ' on' : ''}" data-rktab="${k}">${t(
            k === 'corps' ? 'rank.tab.corps' : 'rank.tab.players',
          )}</button>`,
      )
      .join('') +
    `</div>`;
  if (!opts.signedIn) {
    return (
      tabs +
      `<div class="hub-empty"><span class="he-ic">▤</span>${t('rank.guest.title')}<br>` +
      `<span style="font-size:11px;color:var(--cyan-dim)">${t('rank.guest.sub')}</span></div>`
    );
  }
  if (view.rows.length === 0) {
    return (
      tabs +
      `<div class="hub-empty"><span class="he-ic">▤</span>${t(
        kind === 'corps' ? 'rank.empty.corps' : 'rank.empty.players',
      )}<br><span style="font-size:11px;color:var(--cyan-dim)">${t(
        kind === 'corps' ? 'rank.empty.corps.sub' : 'rank.empty.players.sub',
      )}</span></div>`
    );
  }
  // Своё место — ВСЕГДА видно. Оно в странице → строка подсвечена там, где стоит;
  // вне страницы → прикрепляется снизу со своим настоящим номером. Поднимать её
  // наверх было бы удобнее, но это ровно то враньё, ради которого доски и читают.
  const inPage = view.rows.some((r) => r.me);
  const mine =
    !inPage && view.me.name !== null
      ? `<div class="rk-mine">` +
        (view.me.rank === null
          ? `<div class="rk-none">${t('rank.me.none')}</div>`
          : rowHtml(
              {
                rank: view.me.rank,
                name: view.me.name,
                score: view.me.score,
                me: true,
              },
              kind,
              true,
            )) +
        `</div>`
      : '';
  return (
    tabs +
    `<div class="rk-total">${t('rank.total', { n: view.total })}</div>` +
    `<div class="rk-list">${view.rows.map((r) => rowHtml(r, kind)).join('')}</div>` +
    mine
  );
}

/** Что вкладке нужно от хаба. */
export interface RankHost {
  /** Панель вкладки (`#hp-rank`) — она же делегат кликов. */
  root(): HTMLElement;
  /** База + токен сессии, или `null` — гость (место знает только аккаунт). */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
}

export function initRank(host: RankHost): { refresh: () => Promise<void> } {
  let kind: BoardKind = 'players';
  let boards: Record<BoardKind, BoardView> = { players: EMPTY_BOARD, corps: EMPTY_BOARD };
  let signedIn = true;

  function paint(): void {
    host.root().innerHTML = boardHtml(kind, boards[kind], { signedIn });
  }

  /** Один запрос на ОБЕ доски: переключение подвкладки — это перерисовка, а не
   *  поход на сервер. Любой сбой тихий — прежние доски остаются на экране. */
  async function refresh(): Promise<void> {
    const auth = await host.authorizedBase();
    if (!auth) {
      signedIn = false;
      boards = { players: EMPTY_BOARD, corps: EMPTY_BOARD };
      paint();
      return;
    }
    signedIn = true;
    try {
      const res = await fetch(`${auth.base}/leaderboard`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });
      if (res.status === 401) {
        // Токен есть, но сервер его не признаёт (перезапуск, сброс пароля, чужая база).
        // Это НЕ «доска пуста» — это «вы не вошли», и сказать надо именно это, иначе
        // игрок будет ждать строк, которых для него не запрашивали.
        signedIn = false;
        boards = { players: EMPTY_BOARD, corps: EMPTY_BOARD };
        paint();
        return;
      }
      const parsed = (await res.json().catch(() => null)) as {
        players?: BoardView;
        corps?: BoardView;
      } | null;
      if (res.ok && parsed)
        boards = {
          players: parsed.players ?? EMPTY_BOARD,
          corps: parsed.corps ?? EMPTY_BOARD,
        };
    } catch {
      /* офлайн — доски остаются прежними */
    }
    paint();
  }

  host.root().addEventListener('click', (ev) => {
    const tab = (ev.target as HTMLElement).closest('[data-rktab]') as HTMLElement | null;
    const next = tab?.dataset.rktab;
    if (next !== 'players' && next !== 'corps') return;
    kind = next;
    paint(); // обе доски уже здесь — переключение не стоит запроса
  });

  return { refresh };
}

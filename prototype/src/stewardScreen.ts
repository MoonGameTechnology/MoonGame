/**
 * «Хранитель» screen (ST-2/ST-3, REFM-7) — the window that hands your seat to a
 * defensive AI until a game-time deadline and takes it back on time.
 *
 * The engine is elsewhere: `stewardModule` in shared-core runs the watch,
 * `stewardGuard.ts` decides its moves, `actions.ts` builds delegate/recall. This is
 * the window: the three states it can be in (locked behind the tech / ready to
 * delegate / on watch), the SITREP journal, and the one piece of view state it owns —
 * which posture the NEXT delegation will run.
 *
 * Same REFM shape as the other screens: everything that only reads state is a plain
 * exported function (so the threat alert, the side panel and the morning report can
 * import the same helpers rather than reach into the window), and `initSteward(host)`
 * takes its host dependencies explicitly.
 */
import { stewardActive, type Action, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
// Straight from the source modules, not through the `game.ts` barrel — same as the
// other REFM screens, so this module never leans on the façade.
import { delegateSteward, recallSteward } from './actions';
import { DAY, HOUR } from './time';

/** Game-hours a single delegation can run — the three offered buttons. */
const STEW_DURATIONS = [4, 8, 12];

/** The posture a delegation runs (ST-3.3): «Оборона» is the safe default, «Активная
 *  оборона» adds the forecast-gated counterstrike + squadron fire-watch. */
export type StewardPosture = 'defend' | 'active_defend';

/** Your standing at a glance — snapshotted when the watch starts and diffed on
 *  expiry for the morning report. */
export interface StewardMetrics {
  planets: number;
  metal: number;
  credits: number;
}

export function stewMetrics(state: GameState, me: string): StewardMetrics {
  let planets = 0;
  for (const pl of Object.values(state.planets)) if (pl.owner === me) planets += 1;
  const r = (state.players[me]?.resources ?? {}) as Record<string, number>;
  return { planets, metal: Math.round(r.metal ?? 0), credits: Math.round(r.credits ?? 0) };
}

/** A duration in the wording the watch uses («2ч 30м» / «45м»). Shared with the threat
 *  alert, which counts down the same way. */
export function stewFmtDur(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}ч ${mins % 60}м` : `${mins}м`;
}

/** Is the Steward unlocked? Researched in the «Командование» branch (day 15, scientist
 *  Куратор) — the side panel gates its hold-point control on the same answer. */
export function stewardTechDone(state: GameState, me: string): boolean {
  return state.players[me]?.technologies?.completed.includes('ai_stewardship') ?? false;
}

/** One entry of the Steward's decision journal (SITREP, ST-2.4). */
export interface StewardLogEntry {
  kind: string;
  at?: number;
  node?: string;
  fleetId?: string;
  to?: string;
  count?: number;
  fraction?: number;
}

/** One localized line of the journal. An unknown kind degrades to `kind: node` rather
 *  than vanishing — a watch that did something must never read as a watch that slept. */
export function stewLogLine(e: StewardLogEntry): string {
  const pct = e.fraction !== undefined ? String(Math.round(e.fraction * 100)) : '?';
  const node = e.node ?? '?';
  switch (e.kind) {
    case 'evac':
      return t('steward.log.evac', { node, to: e.to ?? '?', pct, n: String(e.count ?? 0) });
    case 'ferry':
      return t('steward.log.ferry', { node });
    case 'stranded':
      return t('steward.log.evac-failed', { node, pct });
    case 'strike':
      return t('steward.log.counter', { node, pct });
    case 'watch':
      return t('steward.log.sortie', { node });
    case 'hold':
      return t('steward.log.held', { node, pct });
    case 'reinforce':
      return t('steward.log.reinforce', { node, pct });
    default:
      return `${e.kind}: ${node}`;
  }
}

/** The journal section — the last watch's decisions, newest first. Rendered whenever a
 *  journal exists (it survives expiry: the morning report is read AFTER the watch ends). */
export function stewLogHtml(state: GameState, me: string): string {
  const log = state.players[me]?.stewardLog as StewardLogEntry[] | undefined;
  if (!log || log.length === 0) return '';
  const lines = [...log]
    .reverse()
    .slice(0, 12)
    .map(
      (e) =>
        `<div class="st-log-line"><span class="st-log-when">${t('steward.log.ago', { dur: stewFmtDur(Math.max(0, state.time - (e.at ?? 0))) })}</span> ${stewLogLine(e)}</div>`,
    )
    .join('');
  return `<div class="st-h">${t('steward.log.title')}</div><div class="st-log">${lines}</div>`;
}

/** The window body: on watch → status + recall; no tech → the locked card + a way to
 *  the tech tree; otherwise the compose card (posture + duration). The journal is
 *  appended in every state. `planned` is the posture the NEXT delegation will use. */
export function stewardBodyHtml(
  state: GameState,
  me: string,
  planned: StewardPosture,
): string {
  const posture = stewardActive(state, me, state.time); // null unless a live delegation
  const cur = state.players[me]?.steward;
  let html = '';
  if (posture && cur) {
    html +=
      `<div class="st-status on">🤖 <b>${posture === 'active_defend' ? t('steward.on.active') : t('steward.on.defense')}</b><br>` +
      t('steward.on.returns', { dur: stewFmtDur(cur.until - state.time) }) +
      `<br>` +
      `${posture === 'active_defend' ? t('steward.on.active.note') : t('steward.on.defense.note')}</div>` +
      `<div class="st-row"><button class="st-btn warn" data-stew="recall">${t('steward.take-back')}</button></div>` +
      `<div class="st-note">${t('steward.on.warning')}</div>`;
  } else if (!stewardTechDone(state, me)) {
    const day = Math.floor((state.time - (state.startedAt ?? 0)) / DAY) + 1; // счёт статус-бара: день 1 — первый
    html +=
      `<div class="st-status locked">🔒 <b>${t('steward.locked')}</b><br>` +
      t('steward.locked.where', { day: String(day) }) +
      `<br>` +
      `${t('steward.locked.how')}</div>` +
      `<div class="st-row"><button class="st-btn" data-stew="tech">${t('steward.locked.go')}</button></div>`;
  } else {
    html +=
      `<div class="st-status">😴 <b>${t('steward.ready')}</b><br>` +
      `${t('steward.ready.note')}</div>` +
      `<div class="st-h">${t('steward.stance')}</div><div class="st-row">` +
      (['defend', 'active_defend'] as const)
        .map(
          (p) =>
            `<button class="st-btn${planned === p ? ' sel' : ''}" data-stew="posture" data-p="${p}">${p === 'defend' ? t('steward.stance.defense') : t('steward.stance.active')}</button>`,
        )
        .join('') +
      `</div>` +
      `<div class="st-h">${t('steward.duration')}</div><div class="st-row">` +
      STEW_DURATIONS.map(
        (h) =>
          `<button class="st-btn" data-stew="go" data-h="${h}">${t('steward.duration.hours', { h: String(h) })}</button>`,
      ).join('') +
      `</div>` +
      `<div class="st-note">${
        planned === 'active_defend'
          ? t('steward.stance.active.note')
          : t('steward.stance.defense.note')
      }</div>`;
  }
  return html + stewLogHtml(state, me);
}

/** What the window needs from the match screen. */
export interface StewardHost {
  /** The window element (`#steward`) — shown/hidden and click-delegated here. */
  root(): HTMLElement;
  /** The body element inside it (`#stewardbody`) — the part that repaints. */
  body(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose seat is being delegated: the player you are. */
  me(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Fired when the window opens — the host shows its just-in-time intro card here. */
  onOpen(): void;
  /** «Research it» on the locked card: close this window, open the tech tree. */
  openTech(): void;
}

/** Wire the window up. Call once at boot (it attaches the click delegate); `open()` is
 *  what the rail button calls, `repaint()` what the frame loop calls to keep the
 *  countdown live while the window is open. */
export function initSteward(host: StewardHost): {
  open: () => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let planned: StewardPosture = 'defend';

  const isOpen = (): boolean => host.root().classList.contains('show');
  const repaint = (): void => {
    host.body().innerHTML = stewardBodyHtml(host.state(), host.me(), planned);
  };

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      host.root().classList.remove('show');
      return;
    }
    const btn = tg.closest('[data-stew]') as HTMLElement | null;
    if (!btn) return;
    const kind = btn.dataset.stew;
    if (kind === 'posture') {
      planned = btn.dataset.p === 'active_defend' ? 'active_defend' : 'defend';
    } else if (kind === 'go') {
      const hours = Number(btn.dataset.h) || 8;
      host.order(delegateSteward(host.me(), host.state().time + hours * HOUR, planned));
    } else if (kind === 'recall') {
      host.order(recallSteward(host.me()));
    } else if (kind === 'tech') {
      host.root().classList.remove('show');
      host.openTech();
      return;
    }
    repaint();
  });

  return {
    open: () => {
      host.root().classList.add('show');
      repaint();
      host.onOpen();
    },
    repaint,
    isOpen,
  };
}

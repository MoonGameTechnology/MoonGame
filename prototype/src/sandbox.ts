/**
 * =============================================================================
 *  SANDBOX MODE — a self-contained, single-player "practice tools" corner.
 * =============================================================================
 *  Like the practice/demo tools in Dota 2 or League of Legends: a solo match
 *  ticked entirely on the client, with a panel of cheats you can flip live.
 *  Everything for it lives in THIS file plus a few clearly fenced hooks in the
 *  shared code. To cut the whole feature without a trace:
 *    1. delete this file (prototype/src/sandbox.ts);
 *    2. remove the `<!-- SANDBOX -->` HTML blocks + the `/* SANDBOX *​/` CSS
 *       block in prototype/build.mjs;
 *    3. remove the `SANDBOX` import + the fenced hooks in prototype/src/main.ts
 *       (the setup checkbox, the frame-loop `enforceSandbox` call, the fog gate,
 *       the free-build snapshot in the order path, and the `initSandbox(...)`
 *       call).
 *  Nothing else references it. It only ever touches the LOCAL solo state — in a
 *  net match the server is authoritative and none of this runs.
 *
 *  Cheats:
 *    - toggles (held every frame): fog of war (on by default — turn it OFF to reveal
 *      the whole map) · instant construction · free construction · immortal home world ·
 *      frozen build queues (everyone) · time-speed controls (the in-match speedbar);
 *    - one-shot commands: instant commander cooldowns · +2000 of a resource ·
 *      end every war (back to neutral).
 */
import { setStance, getStance } from '../../packages/shared-core/src/index';
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from './i18n';

/** Persistent per-match cheat toggles (the four "held" switches). */
export interface SandboxConfig {
  /** The match was launched with the sandbox checkbox on. */
  enabled: boolean;
  /** Fog of war. ON by default (the normal projection); turn it OFF to reveal the
   *  whole map — the client then renders the true state with no fog. */
  fog: boolean;
  /** Every pending `construction.complete` event is pulled due at once — builds finish
   *  the instant they are queued. */
  instantBuild: boolean;
  /** Construction/upgrades/unit builds cost 0 (the spend is refunded). */
  freeBuild: boolean;
  /** The player's home world can never change owner. */
  immortalHome: boolean;
  /** No `construction.complete` event ever elapses — every queue is paused. */
  freezeQueues: boolean;
  /** The player's commanders keep every ability off cooldown (readied each frame). */
  instantCooldown: boolean;
}

const DEFAULTS: SandboxConfig = {
  enabled: false,
  fog: true,
  instantBuild: false,
  freeBuild: false,
  immortalHome: false,
  freezeQueues: false,
  instantCooldown: false,
};

/** The live config (mutated in place so the host can read it each frame). */
export const sandboxConfig: SandboxConfig = { ...DEFAULTS };

/** Reset to defaults — the host calls this when the setup screen (re)opens. */
export function resetSandboxConfig(): void {
  Object.assign(sandboxConfig, DEFAULTS);
}

/** The five session resources, in HUD order (icon + canonical Russian name). */
const RESOURCES: Array<{ key: string; icon: string; name: string }> = [
  { key: 'credits', icon: '¤', name: 'Кредиты' },
  { key: 'food', icon: '❖', name: 'Пища' },
  { key: 'metal', icon: '⬢', name: 'Металл' },
  { key: 'energy', icon: '↯', name: 'Энергия' },
  { key: 'microelectronics', icon: '▦', name: 'Микроэлектроника' },
];
const GRANT = 2000;

/** Action types that pay a resource cost up front — the ones "free build" waives. */
const BUILD_ACTIONS = new Set([
  'building.construct',
  'building.upgrade',
  'unit.build',
  'construction.resume',
]);
export function isBuildAction(type: string): boolean {
  return BUILD_ACTIONS.has(type);
}

// --- one-shot commands (pure state edits on the local solo state) ------------

/** +`GRANT` of one resource to the player's treasury. */
export function sbAddResource(s: GameState, me: string, key: string): string {
  const p = s.players[me];
  if (!p) return t('нет игрока');
  p.resources[key] = (p.resources[key] ?? 0) + GRANT;
  const r = RESOURCES.find((x) => x.key === key);
  return t('+{n} {res}', { n: GRANT, res: r ? t(r.name) : key });
}

/** Ready every ability of the player's commanders (keep any death timer, so a fallen
 *  hero is not left "ready but dead"). Driven each frame by the `instantCooldown`
 *  toggle. Returns true if it actually cleared a pending cooldown. */
export function sbReadyCommanders(s: GameState, me: string): boolean {
  let changed = false;
  for (const h of Object.values(s.heroes ?? {})) {
    if (h.owner !== me) continue;
    const respawn = h.cooldowns.respawn;
    if (Object.keys(h.cooldowns).some((k) => k !== 'respawn' && h.cooldowns[k]! > s.time)) {
      changed = true;
    }
    h.cooldowns = respawn !== undefined ? { respawn } : {};
  }
  return changed;
}

/** End every war the player is in — pairs at `war` return to `peace` (neutral). */
export function sbEndWars(s: GameState, me: string): string {
  let ended = 0;
  for (const other of Object.keys(s.players)) {
    if (other === me) continue;
    if (getStance(s, me, other) === 'war') {
      setStance(s, me, other, 'peace');
      ended++;
    }
  }
  return ended > 0
    ? t('Войны прекращены: {n} — отношения нейтральные', { n: ended })
    : t('Вы ни с кем не воюете');
}

// --- per-frame enforcement for the "held" toggles ----------------------------

// Remaining time (ms) of each frozen `construction.complete` event, captured when
// the freeze turned on. Held forward every frame so the queue never elapses; the
// original countdown resumes untouched once the freeze lifts. Cleared per match.
const frozenRemaining = new Map<string, number>();

/** Drop all per-match runtime — the host calls this when a fresh match installs. */
export function resetSandboxRuntime(): void {
  frozenRemaining.clear();
}

/** Hold the "immortal home" and "frozen queues" toggles. Called every solo frame
 *  (after the world advanced) while the sandbox is enabled. `me`/`homeId` are the
 *  local player and their home world. */
export function enforceSandbox(s: GameState, me: string, homeId: string | null): void {
  if (sandboxConfig.immortalHome && homeId) {
    const p = s.planets[homeId];
    if (p && p.owner !== me) {
      p.owner = me; // re-assert ownership — a walk-in capture flips straight back
      const held = p.garrison.reduce((a, u) => a + u.count, 0);
      if (held === 0) p.garrison = [{ unit: 'militia', count: 20 }]; // keep it defensible
    }
  }
  if (sandboxConfig.freezeQueues) {
    // Hold every construction-completion `rem` ms in the future, so the build-panel
    // ETA reads honestly as "frozen at rem" and the event never elapses. (Caveat: at
    // extreme time-speeds a build within a single frame's advance of completing can
    // slip through before the next re-bump — a harmless sandbox imperfection.)
    for (const ev of s.scheduled) {
      if (ev.type !== 'construction.complete') continue;
      let rem = frozenRemaining.get(ev.id);
      if (rem === undefined) {
        rem = Math.max(0, ev.at - s.time);
        frozenRemaining.set(ev.id, rem);
      }
      ev.at = s.time + rem; // stay `rem` in the future — never becomes due while frozen
    }
  } else if (frozenRemaining.size > 0) {
    frozenRemaining.clear(); // freeze lifted → let the captured events elapse normally
  }
  if (sandboxConfig.instantBuild) {
    // Pull every pending build to `now` so the next `advanceTo` fires it — construction
    // finishes the instant it is queued. (Contradicts "freeze queues"; if both are on,
    // instant-build wins because it runs last.)
    for (const ev of s.scheduled) {
      if (ev.type === 'construction.complete' && ev.at > s.time) ev.at = s.time;
    }
  }
  if (sandboxConfig.instantCooldown) sbReadyCommanders(s, me); // hold abilities ready
}

// --- in-match panel (DOM) ----------------------------------------------------

/** The only things the panel borrows from the host — passed in once. */
export interface SandboxHooks {
  getState: () => GameState;
  me: () => string;
  homeId: () => string | null;
  note: (msg: string) => void;
  /** Read/write the host's «управление скоростью» flag (the in-match speedbar). Lives
   *  outside `sandboxConfig` because it persists across matches (localStorage). */
  getSpeedControl: () => boolean;
  setSpeedControl: (on: boolean) => void;
}

const TOGGLES: Array<{ key: keyof SandboxConfig; label: string; hint: string }> = [
  { key: 'fog', label: 'Туман войны', hint: 'Выключите, чтобы открыть всю карту' },
  { key: 'instantBuild', label: 'Моментальная постройка', hint: 'Стройка завершается мгновенно' },
  { key: 'freeBuild', label: 'Бесплатная прокачка', hint: 'Постройки не тратят ресурсы' },
  { key: 'immortalHome', label: 'Бессмертный дом', hint: 'Домашний мир нельзя захватить' },
  { key: 'freezeQueues', label: 'Заморозить очередь', hint: 'Стройка стоит у всех' },
  { key: 'instantCooldown', label: 'Перезарядка скиллов', hint: 'Умения командиров всегда готовы' },
];

/** Wire the `#sandbox` overlay + its floating opener. No-op if the markup is
 *  absent (player build — the fences are stripped). */
export function initSandbox(hooks: SandboxHooks): void {
  const el = document.getElementById('sandbox');
  const btn = document.getElementById('sandboxbtn');
  if (!el || !btn) return;

  const show = (on: boolean): void => {
    el.style.display = on ? 'flex' : 'none';
    if (on) render();
  };

  // A toggle styled exactly like the ones in «Настройки»: a label + sub-line on the
  // left, a sliding switch + вкл/выкл readout on the right.
  const switchRow = (attrs: string, label: string, hint: string, on: boolean): string =>
    `<div class="set-row"><div class="set-lbl">${t(label)}<span class="set-sub">${t(hint)}</span></div>` +
    `<div class="set-ctl"><label class="set-switch"><input type="checkbox" ${attrs}${on ? ' checked' : ''}>` +
    `<span class="sw-track"></span><span class="sw-knob"></span></label>` +
    `<span class="set-val">${on ? t('вкл') : t('выкл')}</span></div></div>`;

  const resBtns = RESOURCES.map(
    (r) =>
      `<button class="sbx-cmd" data-sbx="res" data-k="${r.key}"><i>${r.icon}</i>+${GRANT} ${t(r.name)}</button>`,
  ).join('');

  function render(): void {
    if (!el) return;
    const togs = TOGGLES.map((tg) =>
      switchRow(`data-sbx="tog" data-k="${tg.key}"`, tg.label, tg.hint, sandboxConfig[tg.key]),
    ).join('');
    const speedRow = switchRow(
      'data-sbx="speed"',
      'Управление скоростью',
      'панель времени в матче — пауза и множители ускорения (1× — реальное время)',
      hooks.getSpeedControl(),
    );
    el.innerHTML = `<div class="sbx-box-w">
      <div class="sbx-title"><span class="dia"></span><b>${t('ПЕСОЧНИЦА')}</b><span class="sbx-dev">DEV</span></div>
      <div class="sbx-label">${t('Переключатели')}</div>
      <div class="sbx-togs">${togs}${speedRow}</div>
      <div class="sbx-label">${t('Команды')}</div>
      <div class="sbx-cmds">${resBtns}</div>
      <button class="sbx-cmd" data-sbx="peace">${t('Прекратить войну со всеми фракциями')}</button>
      <button class="sbx-close" data-sbx="close">${t('Закрыть')}</button>
    </div>`;
  }

  // The switches are real checkboxes → drive them off `change` (fires once), leaving
  // `click` for the command buttons and the tap-outside-to-close backdrop.
  el.addEventListener('change', (ev) => {
    const inp = (ev.target as Element).closest('[data-sbx]') as HTMLInputElement | null;
    if (!inp) return;
    if (inp.dataset.sbx === 'tog') {
      (sandboxConfig[inp.dataset.k as keyof SandboxConfig] as boolean) = inp.checked;
      render();
    } else if (inp.dataset.sbx === 'speed') {
      hooks.setSpeedControl(inp.checked);
      render();
    }
  });

  el.addEventListener('click', (ev) => {
    const tgt = (ev.target as Element).closest('[data-sbx]') as HTMLElement | null;
    if (!tgt) {
      if (ev.target === el) show(false); // click on the backdrop (outside the box) → close
      return;
    }
    const act = tgt.dataset.sbx;
    if (act === 'close') {
      show(false);
    } else if (act === 'res') {
      hooks.note('🧪 ' + sbAddResource(hooks.getState(), hooks.me(), tgt.dataset.k ?? ''));
    } else if (act === 'peace') {
      hooks.note('🧪 ' + sbEndWars(hooks.getState(), hooks.me()));
    }
  });

  btn.addEventListener('click', () => show(el.style.display !== 'flex'));

  // Expose the opener so the host can toggle the button's visibility per match.
  (btn as unknown as { _sbxShow?: (on: boolean) => void })._sbxShow = (on: boolean) => {
    btn.style.display = on ? '' : 'none';
    if (!on) show(false);
  };
}

/** Show/hide the floating opener for the current match (host calls on match start). */
export function setSandboxButton(on: boolean): void {
  const btn = document.getElementById('sandboxbtn') as unknown as {
    _sbxShow?: (on: boolean) => void;
  } | null;
  btn?._sbxShow?.(on);
}

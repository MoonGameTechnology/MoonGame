/**
 * Division template designer (H4, REFM-8) — the Stellaris-style editor where a ground
 * design is built BEFORE it is mobilised; the planet panel only picks a ready design.
 *
 * Three custom templates are editable + renamable; the named officer templates are
 * locked premades shown for reference («готовый шаблон, менять нельзя»). A mobilised
 * division is a SNAPSHOT — editing a template later never touches armies already in
 * the field, which is why this screen only ever emits orders and never mutates.
 *
 * `formations.ts` is the model (roster, template shape, aggregate stats, presets),
 * `actions.ts` builds the orders. Same REFM shape as the other screens: the markup is
 * pure (`divDesignHtml`), and `initDivDesign(host)` takes its host deps explicitly.
 */
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc, TECH_CUR } from './format';
import { formIcon } from './icons';
import {
  FORMATION_SLOTS,
  FORMATION_UNITS,
  FORM_RU,
  OFFICER_TEMPLATES,
  formationStats,
  type FormationTemplate,
  type FormationUnit,
} from './formations';
import { GROUND_ROSTER, OFFICERS } from './groundcombat';
import { templatesOf } from './division';
import { setDivisionTemplate, renameDivisionTemplate } from './actions';

/** The designs the tab row offers: your editable templates first, then the locked
 *  officer premades. The index the screen keeps is an index INTO THIS LIST. */
export function designList(
  state: GameState,
  me: string,
): Array<{ tpl: FormationTemplate; officer?: string }> {
  return [
    ...templatesOf(state, me).map((tpl) => ({ tpl })),
    ...OFFICER_TEMPLATES.map((tpl) => ({ tpl, officer: tpl.officer })),
  ];
}

/** The whole editor body for design `idx`: tab row, name/lock card, the six slots, the
 *  per-target damage preview (the counter matrix made visible), and the roster line.
 *  `idx` is clamped here too, so a stale index can never index past the list. */
export function divDesignHtml(
  state: GameState,
  me: string,
  idx: number,
  pcUi: boolean,
): string {
  const all = designList(state, me);
  // Clamp ONCE and use the clamped value everywhere below — clamping only the picked
  // design would render the last one while highlighting no tab at all.
  const at = Math.max(0, Math.min(idx, all.length - 1));
  const pick = all[at];
  if (!pick) return '';
  const locked = pick.officer !== undefined;
  let h = `<div class="dd-tabs">`;
  for (let i = 0; i < all.length; i++) {
    h += `<button data-ddtab="${i}" class="${i === at ? 'on' : ''}">${all[i]!.officer ? '★ ' : ''}${esc(t(all[i]!.tpl.name))}</button>`;
  }
  h += `</div>`;
  if (locked) {
    const off = OFFICERS[pick.officer!];
    const bonus = [
      off?.atk ? `+${Math.round(off.atk * 100)}% ${t('div.stat.attack')}` : '',
      off?.def ? `+${Math.round(off.def * 100)}% ${t('div.stat.defense')}` : '',
      off?.hp ? `+${Math.round(off.hp * 100)}% ${t('div.stat.hp')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    h += `<div class="dd-lock">★ ${esc(t(off?.name ?? ''))} — ${bonus}</div>`;
    h += `<div class="dd-lock">${t('div.officer-locked')}</div>`;
  } else {
    h += `<div class="dd-name"><input id="dd-name" maxlength="24" value="${esc(pick.tpl.name)}"><button class="b" data-ddrename>${t('div.rename')}</button></div>`;
  }
  h += `<div class="dd-slots">`;
  for (let i = 0; i < FORMATION_SLOTS; i++) {
    const u = pick.tpl.slots[i] ?? null;
    h += `<button data-ddslot="${i}"${locked ? ' disabled' : ''}>${u ? `${formIcon(u, pcUi)} ${esc(t(FORM_RU[u] ?? u))}` : '＋'}</button>`;
  }
  h += `</div>`;
  const f = formationStats(pick.tpl);
  // Per-target damage preview: the counter matrix made visible — Σ atk of the
  // composition against each of the four unit types.
  const vs = (target: string): number =>
    pick.tpl.slots.reduce(
      (n, u) => n + (u ? (GROUND_ROSTER[u]?.atk[target as FormationUnit] ?? 0) : 0),
      0,
    );
  h += `<div class="dd-vs">`;
  for (const tgt of FORMATION_UNITS) {
    const v = vs(tgt);
    h += `<div class="vrow"><span class="vnm">${t('div.damage-vs')} ${formIcon(tgt, pcUi)} ${esc(t(FORM_RU[tgt] ?? tgt))}</span><div class="vtrack"><div class="vbar" style="width:${Math.min(100, Math.round((v / 90) * 100))}%"></div></div><span>${v}</span></div>`;
  }
  h += `</div>`;
  const cost =
    Object.entries(f.cost)
      .map(([r, a]) => `<span class="rc-${r}">${a}${TECH_CUR[r] ?? r[0]}</span>`)
      .join(' ') || '—';
  const syn = f.synergies.map((x) => `${esc(t(x.name))} — ${esc(t(x.desc))}`).join('<br>');
  h += `<div class="row dim">⚔${f.attack} 🛡${f.defense} ❤${f.hp} · ${t('div.roster', { n: f.count, s: FORMATION_SLOTS, rest: cost })}</div>`;
  if (syn) h += `<div class="hint2">${syn}</div>`;
  h += `<div class="hint2">${t('div.slot.note')}</div>`;
  return h;
}

/** The next unit a slot cycles to: null → militia → … → tank → null. */
export function nextSlotUnit(cur: string | null): string | null {
  const order: (string | null)[] = [null, ...FORMATION_UNITS];
  return order[(order.indexOf(cur) + 1) % order.length] ?? null;
}

/** What the designer needs from the match screen. */
export interface DivDesignHost {
  /** The window element (`#divdesign`) — click-delegated here. */
  root(): HTMLElement;
  /** The body element inside it (`#divdesignbody`) — the part that repaints. */
  body(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose designs these are: the seat you are playing. */
  me(): string;
  /** PC layout? Decides the roster glyph family (text vs emoji). */
  pcUi(): boolean;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Fired when the window closes: the mobilise picker mirrors these templates, so the
   *  host drops its cached panel HTML to force a refresh. */
  onClose(): void;
}

/** Wire the designer up. Call once at boot (it attaches the window's click delegate);
 *  `open(idx)` is what the planet panel calls — it hands over the template the
 *  mobilise picker was showing, so «редактировать» lands on the design you were
 *  looking at rather than resetting to the first. */
export function initDivDesign(host: DivDesignHost): {
  open: (idx?: number) => void;
  repaint: () => void;
} {
  let idx = 0; // selected design: 0..2 custom, 3+ officer premades

  const repaint = (): void => {
    const all = designList(host.state(), host.me());
    idx = Math.max(0, Math.min(idx, all.length - 1));
    host.body().innerHTML = divDesignHtml(host.state(), host.me(), idx, host.pcUi());
  };

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.tw-close')) {
      host.root().classList.remove('show');
      host.onClose();
      return;
    }
    const tab = tg.closest('[data-ddtab]') as HTMLElement | null;
    if (tab) {
      idx = Number(tab.dataset.ddtab);
      repaint();
      return;
    }
    // Editing is only ever offered on YOUR templates — the officer premades sit past
    // their count in the list and their slot buttons ship `disabled`.
    const mine = templatesOf(host.state(), host.me());
    const slot = tg.closest('[data-ddslot]') as HTMLButtonElement | null;
    if (slot && !slot.disabled && idx < mine.length) {
      const si = Number(slot.dataset.ddslot);
      const cur = mine[idx]?.slots[si] ?? null;
      host.order(setDivisionTemplate(host.me(), idx, si, nextSlotUnit(cur)));
      repaint();
      return;
    }
    if (tg.closest('[data-ddrename]')) {
      const input = host.root().querySelector('#dd-name') as HTMLInputElement | null;
      const name = input?.value.trim() ?? '';
      if (name && idx < mine.length) {
        host.order(renameDivisionTemplate(host.me(), idx, name));
        repaint();
      }
    }
  });

  return {
    open: (start?: number) => {
      if (typeof start === 'number') idx = Math.max(0, start);
      host.root().classList.add('show');
      repaint();
    },
    repaint,
  };
}

/**
 * Ground division templates (HOI4-style) — the formation roster, template shapes,
 * starter/officer presets, and the aggregate combat rating + doctrine labels.
 * Extracted from `game.ts` (REFP-5): depended only on `data` (unit costs/hp) and
 * `GROUND_ROSTER`/`DamageTable` from `groundcombat.ts`. `game.ts` re-exports the
 * public surface for `main.ts` / `formation.test.ts` / `division.test.ts`.
 */
import { GROUND_ROSTER, type DamageTable } from './groundcombat';
import { data } from './prototypeData';

/** The unit ids a template slot may hold — the formation roster (data.units above). */
export const FORMATION_UNITS = ['militia', 'heavy_infantry', 'special_forces', 'tank'] as const;
export type FormationUnit = (typeof FORMATION_UNITS)[number];
/** Slots per template, and templates per player. */
export const FORMATION_SLOTS = 6;
export const FORMATION_TEMPLATE_COUNT = 3;

/** A division template: a name + exactly FORMATION_SLOTS slots (a unit id or null). */
export interface FormationTemplate {
  name: string;
  slots: (FormationUnit | null)[];
}

/** The three starter templates a player gets before customising them. */
export const DEFAULT_TEMPLATES: FormationTemplate[] = [
  {
    name: 'Линия',
    slots: ['heavy_infantry', 'heavy_infantry', 'militia', 'militia', 'tank', 'tank'],
  },
  {
    name: 'Кулак',
    slots: ['tank', 'tank', 'tank', 'special_forces', 'heavy_infantry', 'heavy_infantry'],
  },
  {
    name: 'Рейд',
    slots: ['special_forces', 'special_forces', 'special_forces', 'militia', 'militia', null],
  },
];

/** Именные офицерские дивизии (H4): ГОТОВЫЕ шаблоны с встроенным офицером — состав
 *  закреплён, редактировать нельзя (конструктор их только показывает). Мобилизация
 *  сразу прикрепляет офицера. */
export interface OfficerTemplate extends FormationTemplate {
  officer: string; // OFFICERS key
}
export const OFFICER_TEMPLATES: OfficerTemplate[] = [
  {
    name: 'Гвардия прорыва',
    officer: 'assault',
    slots: ['tank', 'tank', 'special_forces', 'special_forces', 'heavy_infantry', 'heavy_infantry'],
  },
  {
    name: 'Железный рубеж',
    officer: 'defender',
    slots: [
      'heavy_infantry',
      'heavy_infantry',
      'heavy_infantry',
      'heavy_infantry',
      'militia',
      'militia',
    ],
  },
  {
    name: 'Колонна снабжения',
    officer: 'quartermaster',
    slots: ['militia', 'militia', 'militia', 'heavy_infantry', 'heavy_infantry', 'tank'],
  },
];

/** A composition doctrine the template's mix unlocks — an organisational LABEL
 *  (combined-arms, entrenched, …), NOT a combat bonus: it carries no multiplier and
 *  combat never reads it (BF-23). Purely descriptive flavour for the designer. */
export interface FormationSynergy {
  key: string;
  name: string;
  desc: string;
}
/** Aggregate characteristics of a division template — the designer's combat readout.
 *  attack/defense are a compact rating: Σ over slots of each unit's MEAN per-target damage
 *  in the SAME ground roster combat resolves from (groundcombat.ts) — an expected weight vs
 *  an even enemy mix, so the preview tracks real combat instead of an unrelated paper stat.
 *  `synergies` are organisational doctrine labels only — no combat multiplier (BF-23). */
export interface FormationStats {
  count: number;
  byType: Record<FormationUnit, number>;
  attack: number;
  defense: number;
  hp: number;
  cost: Record<string, number>;
  synergies: FormationSynergy[];
}

/** Compute a template's aggregate combat rating + the doctrine LABELS its composition
 *  unlocks (combined-arms / entrenched / armour / raid / human-wave). attack/defense are
 *  Σ over slots of the unit's MEAN per-target damage in the ground roster — the SAME table
 *  combat resolves from — so the preview is grounded in real combat, not an unrelated paper
 *  stat (BF-23 tail). Doctrines are labels only, no multiplier. Pure + deterministic. */
export function formationStats(tpl: FormationTemplate): FormationStats {
  const byType: Record<FormationUnit, number> = {
    militia: 0,
    heavy_infantry: 0,
    special_forces: 0,
    tank: 0,
  };
  // A unit's single-number weight = the mean of its per-target damage row in GROUND_ROSTER
  // (expected damage vs an even enemy mix); `atk` when attacking, `def` on return fire.
  const rosterMean = (row: DamageTable): number =>
    FORMATION_UNITS.reduce((s, t) => s + (row[t] ?? 0), 0) / FORMATION_UNITS.length;
  let baseAtk = 0;
  let baseDef = 0;
  let hp = 0;
  const cost: Record<string, number> = {};
  for (const slot of tpl.slots) {
    if (!slot) continue;
    const def = data.units[slot];
    if (!def) continue;
    byType[slot] += 1;
    const prof = GROUND_ROSTER[slot];
    baseAtk += prof ? rosterMean(prof.atk) : 0;
    baseDef += prof ? rosterMean(prof.def) : 0;
    hp += def.stats.hp ?? 0;
    for (const [res, amt] of Object.entries(def.cost ?? {})) cost[res] = (cost[res] ?? 0) + amt;
  }
  const infantry = byType.militia + byType.heavy_infantry + byType.special_forces;
  const count = infantry + byType.tank;
  // Composition doctrines — organisational LABELS the mix unlocks (combined arms, an
  // entrenched heavy line, an armoured fist, a spec-ops raid, the cheap human wave).
  // Descriptive ONLY: combat resolves per-target from the ground roster + officer, so a
  // doctrine grants no attack/defence multiplier — the preview must not advertise one (BF-23).
  const synergies: FormationSynergy[] = [];
  if (infantry > 0 && byType.tank > 0) {
    synergies.push({
      key: 'combined',
      name: 'Комбинированные войска',
      desc: 'Пехота и танки в одном строю',
    });
  }
  if (byType.heavy_infantry >= 3) {
    synergies.push({ key: 'entrench', name: 'Окопались', desc: '≥3 тяжёлой пехоты держат рубеж' });
  }
  if (byType.tank >= 3) {
    synergies.push({
      key: 'armor',
      name: 'Танковый кулак',
      desc: '≥3 танков — ударный клин',
    });
  }
  if (byType.special_forces >= 2 && byType.militia === 0) {
    synergies.push({
      key: 'raid',
      name: 'Рейдовая доктрина',
      desc: '≥2 спецназа без ополчения',
    });
  }
  if (byType.militia >= 4) {
    synergies.push({ key: 'wave', name: 'Людская волна', desc: '≥4 ополчения — берут числом' });
  }
  return {
    count,
    byType,
    attack: Math.round(baseAtk),
    defense: Math.round(baseDef),
    hp,
    cost,
    synergies,
  };
}
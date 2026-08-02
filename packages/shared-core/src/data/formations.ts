import type { GameData } from './schemas';
import { GROUND_ROSTER, type DamageTable } from '../state/groundCombat';

/**
 * Ground division templates (HOI4-style) — the formation roster, template shapes,
 * starter/officer presets, and the aggregate combat rating + doctrine labels. Port
 * of the prototype's `formations.ts` (same numbers, same localization keys) into
 * `shared-core` so `division.ts` (the mobilization module) can live here alongside
 * the ground-combat engine it drives, instead of only in the prototype's local
 * simulation. `data` is passed in (unit cost/hp) rather than imported, matching
 * every other shared-core function that reads `GameData`.
 */

/** The unit ids a template slot may hold — the formation roster (data.units above).
 *  Deliberately narrow (same FND-4 scope as `state/groundCombat.ts`'s roster). */
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
    name: 'form.tpl.line',
    slots: ['heavy_infantry', 'heavy_infantry', 'militia', 'militia', 'tank', 'tank'],
  },
  {
    name: 'form.tpl.fist',
    slots: ['tank', 'tank', 'tank', 'special_forces', 'heavy_infantry', 'heavy_infantry'],
  },
  {
    name: 'form.tpl.raid',
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
    name: 'form.tpl.breakthrough',
    officer: 'assault',
    slots: ['tank', 'tank', 'special_forces', 'special_forces', 'heavy_infantry', 'heavy_infantry'],
  },
  {
    name: 'form.tpl.iron-line',
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
    name: 'form.tpl.supply',
    officer: 'quartermaster',
    slots: ['militia', 'militia', 'militia', 'heavy_infantry', 'heavy_infantry', 'tank'],
  },
];

/** A composition doctrine the template's mix unlocks — an organisational LABEL
 *  (combined-arms, entrenched, …), NOT a combat bonus: it carries no multiplier and
 *  combat never reads it. Purely descriptive flavour for the designer. */
export interface FormationSynergy {
  key: string;
  name: string;
  desc: string;
}
/** Aggregate characteristics of a division template — the designer's combat readout.
 *  attack/defense are a compact rating: Σ over slots of each unit's MEAN per-target damage
 *  in the SAME ground roster combat resolves from (`state/groundCombat.ts`) — an expected
 *  weight vs an even enemy mix, so the preview tracks real combat instead of an unrelated
 *  paper stat. `synergies` are organisational doctrine labels only — no combat multiplier. */
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
 *  unlocks (combined-arms / entrenched / armour / raid / human-wave). Pure + deterministic. */
export function formationStats(tpl: FormationTemplate, data: GameData): FormationStats {
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
  const synergies: FormationSynergy[] = [];
  if (infantry > 0 && byType.tank > 0) {
    synergies.push({
      key: 'combined',
      name: 'form.syn.combined.name',
      desc: 'form.syn.combined.desc',
    });
  }
  if (byType.heavy_infantry >= 3) {
    synergies.push({ key: 'entrench', name: 'form.syn.entrench.name', desc: 'form.syn.entrench.desc' });
  }
  if (byType.tank >= 3) {
    synergies.push({
      key: 'armor',
      name: 'form.syn.armor.name',
      desc: 'form.syn.armor.desc',
    });
  }
  if (byType.special_forces >= 2 && byType.militia === 0) {
    synergies.push({
      key: 'raid',
      name: 'form.syn.raid.name',
      desc: 'form.syn.raid.desc',
    });
  }
  if (byType.militia >= 4) {
    synergies.push({ key: 'wave', name: 'form.syn.wave.name', desc: 'form.syn.wave.desc' });
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

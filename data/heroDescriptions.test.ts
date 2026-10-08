/**
 * ОПИСАНИЯ ГЕРОЯ НАЗЫВАЮТ СВОИ ЧИСЛА — И ЭТО ТЕ ЖЕ ЧИСЛА, ЧТО В ДАННЫХ (TXT-4).
 *
 * Описание способности, пассивки и узла дерева выводится как есть, `t(desc)` без
 * подстановки, поэтому величина эффекта живёт прямо в строке локали. Раньше половина
 * этих строк не называла величину вовсе («Временный щит: +оборона своим флотам рядом
 * с героем»). Тест держит две вещи сразу: число в тексте есть, и оно совпадает с
 * `heroAbilities.json` / `heroPassives.json`, так что правка баланса без правки текста
 * краснеет здесь, а не доезжает до игрока неверной цифрой.
 *
 * Узел дерева, который сам ничего не усиливает, а только открывает способность, обязан
 * назвать её по имени («Открывает способность «Коридор»»): игрок тратит очко и должен
 * знать, что купил.
 */
import { describe, expect, it } from 'vitest';
import abilities from './heroAbilities.json';
import passives from './heroPassives.json';
import trees from './heroSkillTrees.json';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import { dataKey } from '../localization/index';

type Params = Record<string, number>;
interface AbilityDef {
  name: string;
  description?: string;
  range: number;
  params: Params;
  tiers?: { params: Params }[];
}
interface PassiveDef {
  description?: string;
  params: Params;
}
interface NodeDef {
  description?: string;
  grants?: { ability?: string; passive?: string; passives?: string[] };
}

const ABILITIES = abilities as unknown as Record<string, AbilityDef>;
const PASSIVES = passives as unknown as Record<string, PassiveDef>;
const NODES = trees as unknown as Record<string, NodeDef>;

const PERCENT = new Set(['combatBonus', 'defenseBonus', 'bonus', 'weakPointBonus', 'evasionBonus']);
/** Служебные параметры, у которых нет величины для игрока. */
const SKIP = new Set(['tier']);

/** Какие токены обязан содержать текст для набора параметров. */
function expectedTokens(params: Params): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (SKIP.has(key) || value === 0) continue;
    out.push(PERCENT.has(key) ? `${Math.round(value * 100)}%` : String(value));
  }
  return out;
}

/** Число стоит в тексте отдельным токеном: «42» не засчитывается внутри «420». */
function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\d.])${escaped}(?![\\d])`).test(text);
}

const LOCALES = [
  ['ru', ru],
  ['en', en],
] as const;

describe('TXT-4: описания героя называют свои числа из данных', () => {
  it('способность: величины, радиусы, длительности и дальность из heroAbilities.json', () => {
    const missing: string[] = [];
    for (const [id, def] of Object.entries(ABILITIES)) {
      if (!def.description) continue;
      const tokens = [
        ...expectedTokens(def.params),
        ...(def.tiers ?? []).flatMap((step) => expectedTokens(step.params)),
        ...(def.range > 0 ? [String(def.range)] : []),
      ];
      for (const [locale, messages] of LOCALES) {
        const text = messages[def.description] ?? '';
        for (const token of tokens) if (!hasToken(text, token)) missing.push(`${locale} ${id}: ${token}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('пассивка: бонус и радиус из heroPassives.json', () => {
    const missing: string[] = [];
    for (const [id, def] of Object.entries(PASSIVES)) {
      if (!def.description) continue;
      for (const [locale, messages] of LOCALES) {
        const text = messages[def.description] ?? '';
        for (const token of expectedTokens(def.params)) {
          if (!hasToken(text, token)) missing.push(`${locale} ${id}: ${token}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('узел дерева называет число либо открываемую способность по имени', () => {
    const vague: string[] = [];
    for (const [id, node] of Object.entries(NODES)) {
      if (!node.description) continue;
      const ability = node.grants?.ability ? ABILITIES[node.grants.ability] : undefined;
      for (const [locale, messages] of LOCALES) {
        const text = messages[node.description] ?? '';
        const named = ability !== undefined && text.includes(messages[dataKey(ability.name)] ?? '\u0000');
        if (!/\d/.test(text) && !named) vague.push(`${locale} ${id}`);
      }
    }
    expect(vague).toEqual([]);
  });
});

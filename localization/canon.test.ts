/**
 * СТОРОЖ КАНОНА ФОРМУЛИРОВОК (TXT-7): чтобы вода не вернулась после чистки блока TXT.
 *
 * `prototype/src/i18n.test.ts` держит ЦЕЛОСТНОСТЬ ключей (паритет, дубли, сироты), а не
 * их содержание. Канон (CLAUDE.md §«Локализация», §3 скилла `localization`) без сторожа —
 * разовая уборка: следующая сессия снова напишет абзац там, где была строка с числом.
 * Здесь только машинно однозначное, иначе сторож превратится в спор о вкусе:
 *
 *  1. **Узел технологии с числовым эффектом называет его величину.** Эффект берётся из
 *     `data/technologies.json`, а не из памяти: правка баланса без правки текста краснеет
 *     здесь. Узел без `effects` (открывает здание, способность или служит предпосылкой)
 *     числа не обязан. Герои под то же правило подпадают в `data/heroDescriptions.test.ts`
 *     (TXT-4); досье кораблей и зданий нет: их числа держит таблица карточки (TXT-8).
 *  2. **Потолок длины по домену.** Порог снят с факта после чистки с запасом в несколько
 *     символов, а не назначен заранее. Строка длиннее потолка допустима только записью в
 *     `LENGTH_EXCEPTIONS` (конвенция `.trivyignore`: ключ, причина, дата). Запись, которая
 *     больше не нужна, тоже красная: список исключений не копит мёртвые строки.
 *  3. **`.desc`, дословно повторяющий свой `.name`, удаляется** (правило 2 канона).
 *
 * Все три проверки — чистые функции, и у каждой есть тест на подсунутом нарушителе:
 * сторож обязан краснеть и называть ключ поимённо (конвенция CORE-DMG-2).
 */
import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { en } from './en';
import technologies from '../data/technologies.json';

type Messages = Record<string, string>;
const LOCALES: [string, Messages][] = [
  ['ru', ru],
  ['en', en],
];

// --- 1. число эффекта ---------------------------------------------------------------

interface TechDef {
  description?: string;
  effects?: Record<string, number>;
}

/** Как величина эффекта выглядит в тексте: доля → «8%», остальное — как есть. */
function effectToken(value: number): string {
  return Math.abs(value) < 5 ? `${Math.round(Math.abs(value) * 100)}%` : String(value);
}

/** Узлы с числовым эффектом, чей текст не называет величину. */
export function missingEffectNumbers(messages: Messages, techs: Record<string, TechDef>): string[] {
  const out: string[] = [];
  for (const [id, def] of Object.entries(techs)) {
    if (!def.description || !def.effects) continue;
    const text = messages[def.description] ?? '';
    for (const [effect, value] of Object.entries(def.effects)) {
      if (!text.includes(effectToken(value))) out.push(`${id}.${effect}: ${effectToken(value)}`);
    }
  }
  return out;
}

// --- 2. потолок длины ---------------------------------------------------------------

/** Домен = шаблон ключа + потолок, общий для обеих локалей. */
export const LENGTH_CEILINGS: { domain: string; pattern: RegExp; max: number }[] = [
  { domain: 'err.*', pattern: /^err\./, max: 70 },
  { domain: 'cmd.*.hint', pattern: /^cmd\..*\.hint$/, max: 100 },
  { domain: 'tech.node.*.desc', pattern: /^tech\.node\..*\.desc$/, max: 180 },
  { domain: 'hero.ability.*.desc', pattern: /^hero\.ability\..*\.desc$/, max: 170 },
  { domain: 'hero.passive.*.desc', pattern: /^hero\.passive\..*\.desc$/, max: 100 },
  { domain: 'hero.tree.*.desc', pattern: /^hero\.tree\..*\.desc$/, max: 150 },
  { domain: 'dossier.unit.*.desc', pattern: /^dossier\.unit\..*\.desc$/, max: 190 },
  { domain: 'dossier.building.*', pattern: /^dossier\.building\./, max: 180 },
  { domain: 'codex.term.*.body', pattern: /^codex\.term\..*\.body$/, max: 220 },
  { domain: 'onb.intro.*.body', pattern: /^onb\.intro\..*\.body$/, max: 105 },
];

/** Ключ → почему ему можно быть длиннее потолка домена. Пустой причины не бывает. */
export const LENGTH_EXCEPTIONS: Record<string, string> = {
  'hero.ability.corridor.desc':
    'три ступени коридора и проход для противника на последней; текст утверждён владельцем 2026-10-07',
  'dossier.unit.landing-shuttle.desc':
    'механика высадки: боец при заказе, захват пустого мира, наземный бой, ПВО; утверждён владельцем 2026-10-06',
  'tech.node.ai-stewardship.desc':
    'узел открывает новую систему (Хранитель) и объясняет её; поток не из блока TXT, чистка после LORE-1; 2026-10-13',
  'tech.node.void-fortification.desc':
    'узел крепости: проза вокруг анлока, отмечена в шапке блока TXT; чистка после LORE-1; 2026-10-13',
  'tech.node.void-shielding.desc':
    'узел крепости (EN длиннее потолка): проза вокруг анлока; чистка после LORE-1; 2026-10-13',
};

/** Ключи длиннее потолка своего домена, кроме записанных исключений. */
export function overLength(messages: Messages, exceptions: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, text] of Object.entries(messages)) {
    const rule = LENGTH_CEILINGS.find((r) => r.pattern.test(key));
    if (rule && text.length > rule.max && !(key in exceptions)) {
      out.push(`${key}: ${text.length} > ${rule.max}`);
    }
  }
  return out;
}

/** Исключения, которые больше не нужны: ключа нет или он влез в потолок в обеих локалях. */
export function staleExceptions(locales: Messages[], exceptions: Record<string, string>): string[] {
  return Object.keys(exceptions).filter((key) => {
    const rule = LENGTH_CEILINGS.find((r) => r.pattern.test(key));
    if (!rule) return true;
    return !locales.some((m) => (m[key]?.length ?? 0) > rule.max);
  });
}

// --- 3. описание = подпись ----------------------------------------------------------

const norm = (s: string): string => s.trim().replace(/[.!…]+$/, '').toLowerCase();

/** `.desc`, повторяющий соседний `.name` с точностью до регистра и точки в конце. */
export function descEchoesName(messages: Messages): string[] {
  return Object.keys(messages).filter((key) => {
    if (!key.endsWith('.desc')) return false;
    const name = messages[`${key.slice(0, -'.desc'.length)}.name`];
    return name !== undefined && norm(name) === norm(messages[key]!);
  });
}

// --- тесты ---------------------------------------------------------------------------

const TECHS = technologies as unknown as Record<string, TechDef>;

describe('TXT-7: канон формулировок держится гейтом', () => {
  it('узел технологии с числовым эффектом называет величину из данных', () => {
    for (const [locale, messages] of LOCALES) {
      expect(missingEffectNumbers(messages, TECHS), locale).toEqual([]);
    }
  });

  it('ни одна строка не длиннее потолка своего домена', () => {
    for (const [locale, messages] of LOCALES) {
      expect(overLength(messages, LENGTH_EXCEPTIONS), locale).toEqual([]);
    }
  });

  it('каждое исключение из потолка ещё нужно и объяснено', () => {
    expect(staleExceptions([ru, en], LENGTH_EXCEPTIONS)).toEqual([]);
    for (const [key, reason] of Object.entries(LENGTH_EXCEPTIONS)) {
      expect(reason.trim().length, key).toBeGreaterThan(20);
    }
  });

  it('ни одно описание не повторяет свою подпись', () => {
    for (const [locale, messages] of LOCALES) {
      expect(descEchoesName(messages), locale).toEqual([]);
    }
  });
});

describe('TXT-7: сторож краснеет на подсунутом нарушителе и называет ключ', () => {
  it('описание без числа при числовом эффекте', () => {
    const techs = { radar_net: { description: 'tech.node.x.desc', effects: { radarRangeBonus: 0.08 } } };
    expect(missingEffectNumbers({ 'tech.node.x.desc': 'Радары видят дальше.' }, techs)).toEqual([
      'radar_net.radarRangeBonus: 8%',
    ]);
    expect(missingEffectNumbers({ 'tech.node.x.desc': 'Связь: +8% к радиусу радаров.' }, techs)).toEqual([]);
  });

  it('слишком длинная строка и мёртвое исключение', () => {
    const long = 'х'.repeat(171);
    expect(overLength({ 'hero.ability.fake.desc': long }, {})).toEqual(['hero.ability.fake.desc: 171 > 170']);
    expect(overLength({ 'hero.ability.fake.desc': long }, { 'hero.ability.fake.desc': 'причина' })).toEqual([]);
    expect(staleExceptions([{ 'hero.ability.fake.desc': 'коротко' }], { 'hero.ability.fake.desc': 'r' })).toEqual([
      'hero.ability.fake.desc',
    ]);
  });

  it('описание, пересказывающее подпись', () => {
    expect(descEchoesName({ 'stat.attack.name': 'Атака', 'stat.attack.desc': 'атака.' })).toEqual(['stat.attack.desc']);
    expect(descEchoesName({ 'stat.attack.name': 'Атака', 'stat.attack.desc': 'Суммарный урон флота.' })).toEqual([]);
  });
});

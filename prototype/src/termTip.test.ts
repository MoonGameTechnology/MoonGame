/**
 * UIX-9.4 / UIX-5.4 — слова-термины и их статьи.
 *
 * Браузерную половину (`initTermTips`) в vitest не поднять — jsdom в репозитории нет, —
 * поэтому политика стопки проверяется в `decisions/terms.test.ts`, а здесь — то, что видит
 * игрок: разметка термина и ТЕКСТЫ статей. Опечатка в ссылке `[[id|слово]]` молча
 * превращает термин в простое слово (правило 2 `terms.ts`), значит ловить её обязан тест.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';
import { termRefIds } from '../../decisions/terms';
import { GLOSSARY } from './codexIndex';
import { STAT_TERM } from './fleetConsole';
import { isTerm, termBody, termHtml, termPlain, termTextHtml, termTitle } from './termTip';

const LOCALES = { ru, en } as const;

describe('статьи словаря в локалях', () => {
  it('каждая ссылка ведёт на существующую статью', () => {
    const bad: string[] = [];
    for (const [lang, table] of Object.entries(LOCALES))
      for (const [key, text] of Object.entries(table))
        for (const id of termRefIds(text)) if (!isTerm(id)) bad.push(`${lang} ${key}: ${id}`);
    expect(bad).toEqual([]);
  });

  it('ссылки живут только в текстах статей — остальной текст их не раскрывает', () => {
    // Кнопка или журнал показали бы игроку скобки: `termTextHtml` зовут только для статей.
    const bodies = new Set(GLOSSARY.map((g) => g.bodyKey));
    const stray: string[] = [];
    for (const [lang, table] of Object.entries(LOCALES))
      for (const [key, text] of Object.entries(table))
        if (text.includes('[[') && !bodies.has(key)) stray.push(`${lang} ${key}`);
    expect(stray).toEqual([]);
  });

  it('у статьи одни и те же ссылки на обоих языках и нет ссылки на саму себя', () => {
    const uniq = (s: string): string[] => [...new Set(termRefIds(s))].sort();
    let linked = 0;
    for (const g of GLOSSARY) {
      expect(uniq(en[g.bodyKey]!), g.id).toEqual(uniq(ru[g.bodyKey]!));
      expect(uniq(ru[g.bodyKey]!), g.id).not.toContain(g.id);
      linked += uniq(ru[g.bodyKey]!).length;
    }
    expect(linked).toBeGreaterThan(4); // разбор не должен молча опустеть
  });

  it('у каждого параметра окна флота есть статья', () => {
    for (const id of Object.values(STAT_TERM)) expect(isTerm(id), id).toBe(true);
  });
});

describe('текст статьи', () => {
  it('линия огня берёт число из ядра, а не из текста', () => {
    expect(termBody('fire-line')).toMatch(/\b10\b/);
    expect(termBody('fire-line')).not.toContain('{n');
  });

  it('без подсказки у статьи нет скобок — только слова', () => {
    for (const g of GLOSSARY) expect(termPlain(g.id), g.id).not.toMatch(/\[\[|\]\]/);
    expect(termPlain('defense')).toContain(termTitle('shield').toLowerCase());
  });

  it('неизвестный термин — пустая статья, а не ключ локали', () => {
    expect(termTitle('nope')).toBe('');
    expect(termBody('nope')).toBe('');
  });
});

describe('разметка термина', () => {
  it('слово-термин — фокусируемый span со ссылкой на статью', () => {
    expect(termHtml('attack', 'Урон в атаке')).toBe(
      '<span class="term" data-term="attack" tabindex="0">Урон в атаке</span>',
    );
  });

  it('текст со ссылками: слова становятся терминами, остальное экранировано', () => {
    const html = termTextHtml('A < B, [[shield|щит]] и [[nope|что-то]].');
    expect(html).toBe(
      'A &lt; B, <span class="term" data-term="shield" tabindex="0">щит</span> и что-то.',
    );
  });

  it('статья защиты раскрывает щит и корпус следующими подсказками', () => {
    const html = termTextHtml(termBody('defense'));
    expect(html).toContain('data-term="shield"');
    expect(html).toContain('data-term="hull"');
  });
});

describe('проводка', () => {
  const read = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('прототип подключает подсказки один раз', () => {
    expect(read('./main.ts').match(/\binitTermTips\(\)/g)?.length).toBe(1);
  });

  it('окно производства подписывает характеристики терминами', () => {
    expect(read('./shipyard.ts')).toContain('termHtml(STAT_TERM[line.stat]');
  });
});

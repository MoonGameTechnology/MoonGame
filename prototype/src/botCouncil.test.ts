// BAL-12 — совет учёных для БОТА.
//
// До кирпича совет получали только человеческие места (`matchSetup`: `if (!seat.ai)`),
// поэтому в self-play, где оба места ботовые, `state.players.*.scientists` был
// `undefined` — и `technologyLock` отбивал ЛЮБОЙ `has_scientist`-узел кодом
// `E_CONDITIONS_UNMET`. Целый слой дерева не измерялся ни разу.
//
// Главное требование к выбору — инвариант №1: он обязан быть функцией СИДА, а не
// порядка перебора каталога. Иначе один и тот же сид разыграется по-разному, как
// только в `data/scientists.json` переставят две записи местами.
import { describe, expect, it } from 'vitest';
import { botCouncil } from './botCouncil';
import { COUNCIL_SIZE } from './sciPick';

const CATALOG = ['overseer', 'polymath', 'void_admiral'];

describe('BAL-12 — детерминированный совет бота', () => {
  it('один и тот же сид и место дают один и тот же совет', () => {
    expect(botCouncil('sp-7', 'p1', CATALOG)).toEqual(botCouncil('sp-7', 'p1', CATALOG));
  });

  it('порядок каталога на выбор НЕ влияет — иначе рушится инвариант детерминизма', () => {
    // Тот самый случай, ради которого выбор считается хешем, а не срезом с начала:
    // перестановка записей в `data/scientists.json` не имеет права менять партию.
    const shuffled = ['void_admiral', 'overseer', 'polymath'];
    expect(botCouncil('sp-7', 'p1', shuffled)).toEqual(botCouncil('sp-7', 'p1', CATALOG));
  });

  it('разные сиды разыгрывают разные советы — слой попадает в измерение целиком', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(botCouncil(`sp-${i}`, 'p1', CATALOG).join('+'));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('места одного матча посвящают советы независимо', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(
        `${botCouncil(`sp-${i}`, 'p1', CATALOG).join('+')}|${botCouncil(`sp-${i}`, 'p2', CATALOG).join('+')}`,
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('совет ровно из COUNCIL_SIZE РАЗНЫХ учёных', () => {
    const council = botCouncil('sp-3', 'p2', CATALOG);
    expect(council).toHaveLength(COUNCIL_SIZE);
    expect(new Set(council).size).toBe(COUNCIL_SIZE);
    for (const id of council) expect(CATALOG).toContain(id);
  });

  it('каталог короче совета — отдаёт что есть, а не пустоту и не дубли', () => {
    // Каталог учёных неполон by design (BAL-13: веток пять, лидеров три), и ужаться он
    // может и дальше. Посвящение обязано деградировать мягко: один учёный лучше нуля.
    expect(botCouncil('sp-1', 'p1', ['overseer'])).toEqual(['overseer']);
    expect(botCouncil('sp-1', 'p1', [])).toEqual([]);
  });
});

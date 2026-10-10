import { describe, expect, it } from 'vitest';
import {
  TERM_DEPTH,
  openTermAt,
  parseTermRefs,
  stripTermRefs,
  termRefIds,
  toggleTermAt,
} from './terms';

const known = (id: string): boolean => ['attack', 'defense', 'hull', 'shield'].includes(id);

describe('parseTermRefs — термины в тексте', () => {
  it('ссылка становится словом-термином, текст вокруг остаётся текстом (правило 1)', () => {
    expect(parseTermRefs('Отвечает [[defense|защитой]], а не атакой.', known)).toEqual([
      { kind: 'text', text: 'Отвечает ' },
      { kind: 'term', id: 'defense', text: 'защитой' },
      { kind: 'text', text: ', а не атакой.' },
    ]);
  });

  it('две ссылки подряд и ссылка в начале — каждая своим куском', () => {
    expect(parseTermRefs('[[shield|Щит]] и [[hull|корпус]]', known)).toEqual([
      { kind: 'term', id: 'shield', text: 'Щит' },
      { kind: 'text', text: ' и ' },
      { kind: 'term', id: 'hull', text: 'корпус' },
    ]);
  });

  it('неизвестный id — просто слово, без скобок, склеенное с соседним текстом (правило 2)', () => {
    expect(parseTermRefs('Сила [[atack|залпа]] флота.', known)).toEqual([
      { kind: 'text', text: 'Сила залпа флота.' },
    ]);
  });

  it('текст без ссылок — один кусок; пустой текст — ни одного', () => {
    expect(parseTermRefs('Просто текст.', known)).toEqual([
      { kind: 'text', text: 'Просто текст.' },
    ]);
    expect(parseTermRefs('', known)).toEqual([]);
  });

  it('недописанная ссылка не считается ссылкой: игрок видит её как есть', () => {
    // Без слова ссылки нет — `[[hull]]` не форма записи, и тест локали её не пропустит.
    expect(parseTermRefs('[[hull]] и [[shield|', known)).toEqual([
      { kind: 'text', text: '[[hull]] и [[shield|' },
    ]);
  });
});

describe('stripTermRefs / termRefIds', () => {
  it('без подсказки от ссылки остаётся только слово (правило 3)', () => {
    expect(stripTermRefs('Урон принимают [[shield|щит]] и [[hull|корпус]].')).toBe(
      'Урон принимают щит и корпус.',
    );
  });

  it('id ссылок — по порядку, неизвестные тоже (их и ищет тест локали)', () => {
    expect(termRefIds('[[shield|щит]], [[nope|что-то]], [[shield|щита]]')).toEqual([
      'shield',
      'nope',
      'shield',
    ]);
  });
});

describe('стопка подсказок (правила 4–5)', () => {
  it('термин на экране открывает первую подсказку, термин в ней — вторую поверх', () => {
    const one = openTermAt([], 0, 'attack');
    expect(one).toEqual(['attack']);
    expect(openTermAt(one, 1, 'defense')).toEqual(['attack', 'defense']);
  });

  it('открытие на уровне N закрывает всё выше N', () => {
    expect(openTermAt(['attack', 'defense', 'shield'], 1, 'hull')).toEqual(['attack', 'hull']);
    expect(openTermAt(['attack', 'defense'], 0, 'hull')).toEqual(['hull']);
  });

  it('повторное наведение на тот же термин стопку не меняет', () => {
    expect(openTermAt(['attack', 'defense'], 1, 'defense')).toEqual(['attack', 'defense']);
  });

  it('статью, открытую ниже, второй раз не открыть: лестница из двух статей не растёт', () => {
    expect(openTermAt(['attack', 'defense'], 2, 'attack')).toEqual(['attack', 'defense']);
  });

  it('стопка не выше TERM_DEPTH', () => {
    const full = ['a', 'b', 'c', 'd'].slice(0, TERM_DEPTH);
    expect(openTermAt(full, TERM_DEPTH, 'e')).toEqual(full);
  });

  it('уровень за вершиной стопки — это вершина: дыр в стопке не бывает', () => {
    expect(openTermAt(['attack'], 5, 'defense')).toEqual(['attack', 'defense']);
  });

  it('касание открытого термина закрывает его подсказку и всё над ней', () => {
    expect(toggleTermAt(['attack', 'defense', 'shield'], 1, 'defense')).toEqual(['attack']);
    expect(toggleTermAt(['attack'], 0, 'attack')).toEqual([]);
  });

  it('касание другого термина работает как открытие', () => {
    expect(toggleTermAt(['attack', 'defense'], 1, 'shield')).toEqual(['attack', 'shield']);
  });
});

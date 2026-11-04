import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { matchCreateDialogHtml, matchSettingsHtml } from './matchCreateDialog';
import { MAP_IDS } from './mapCatalog';

beforeAll(() => setLocale('ru'));

describe('окно «Настройки матча»', () => {
  it('предлагает те же карты, что настройка схватки, и выбранная отмечена', () => {
    const html = matchCreateDialogHtml('ffa-4');
    expect([...html.matchAll(/data-map="([\w-]+)"/g)].map((m) => m[1])).toEqual([...MAP_IDS]);
    expect(html).toContain('data-map="ffa-4" aria-pressed="true"');
    expect(html).toContain('data-mcd-go');
    expect(html).toContain('data-mcd-cancel');
  });

  it('FFA на четверых: игроки, режим и условия победы карты', () => {
    const html = matchSettingsHtml('ffa-4');
    expect(html).toContain('4 игрока');
    expect(html).toContain('Каждый сам за себя');
    expect(html).toMatch(/Базовый порог: \d+ очков/);
    expect(html).toContain('<svg class="mcd-map"');
  });

  it('1 на 1: режим и победа из файла карты (захват столицы)', () => {
    const html = matchSettingsHtml('duel-1');
    expect(html).toContain('1×1 · Захват столицы');
    expect(html).not.toContain('Каждый сам за себя');
    expect(html).not.toContain('Базовый порог');
  });

  it('2 на 2 с захватом столиц: порога очков нет', () => {
    const html = matchSettingsHtml('team-2v2');
    expect(html).toContain('Захватить все вражеские столицы');
    expect(html).not.toContain('Базовый порог');
  });
});

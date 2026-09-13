import { describe, expect, it } from 'vitest';
import { displayUnit, buildingName } from './dataNames';
import { registerMessages, setLocale } from '../localization/core';

// `registerMessages` ЗАМЕНЯЕТ таблицу локали, а не дополняет её — поэтому регистрация
// одна на файл, со всеми нужными ключами сразу.
registerMessages('ru', {
  'data.scout-drone': 'Разведдрон',
  'data.metal-mine': 'Рудник',
});
setLocale('ru');

describe('имена игровых данных', () => {
  it('id юнита и имя каталога сходятся к ОДНОМУ ключу', () => {
    // Смысл правила: `scout_drone` (id) и `Scout Drone` (имя в каталоге) обязаны дать
    // один перевод, иначе игрок увидит имя в одном экране и id в другом.
    expect(displayUnit('scout_drone')).toBe('Разведдрон');
    expect(buildingName('Scout Drone', 'x')).toBe('Разведдрон');
  });

  it('нет перевода — показывается исходное имя, а не ключ', () => {
    // `data.siege-lance` в таблице нет: игрок увидит «siege lance», а не `data.siege-lance`.
    expect(displayUnit('siege_lance')).toBe('siege lance');
  });

  it('у здания имя каталога главнее id, но id — рабочий запасной путь', () => {
    expect(buildingName('Metal Mine', 'whatever')).toBe('Рудник');
    expect(buildingName(undefined, 'metal_mine')).toBe('Рудник');
  });
});

import { describe, it, expect } from 'vitest';
import { dossierLevel, nextHover, showsBody } from './dossierHover';

describe('досье — уровень из ключа', () => {
  it('ключ здания несёт уровень третьим сегментом', () => {
    expect(dossierLevel('b:metal_mine:3')).toBe(3);
  });

  it('НЕ-ЗДАНИЕ УРОВНЯ НЕ ИМЕЕТ: иначе к имени юнита припишется мусор', () => {
    expect(dossierLevel('u:cruiser')).toBe(0);
    expect(dossierLevel('stat:hull')).toBe(0);
  });

  it('здание без третьего сегмента и с мусором вместо числа — ноль', () => {
    expect(dossierLevel('b:metal_mine')).toBe(0);
    expect(dossierLevel('b:metal_mine:')).toBe(0);
    expect(dossierLevel('b:metal_mine:x')).toBe(0);
  });

  it('нулевой уровень остаётся нулём — пометка не дописывается', () => {
    expect(dossierLevel('b:metal_mine:0')).toBe(0);
  });
});

describe('досье — переход наведения', () => {
  it('у курсора новый объект меняет наведение', () => {
    expect(nextHover('cursor', 'u:cruiser', 'b:metal_mine:1')).toEqual({
      changed: true,
      hover: 'u:cruiser',
    });
  });

  it('ПУСТОТА ГАСИТ ВСПЛЫВАШКУ: подсказка над ничем врёт, о чём она', () => {
    expect(nextHover('cursor', null, 'u:cruiser')).toEqual({ changed: true, hover: null });
  });

  it('ПУСТОТА НЕ ГАСИТ ПРИСТЫКОВАННУЮ ПАНЕЛЬ: иначе она мигает на каждом переходе', () => {
    expect(nextHover('docked', null, 'u:cruiser')).toEqual({ changed: false, hover: 'u:cruiser' });
  });

  it('в панели новый объект наведение всё-таки меняет', () => {
    expect(nextHover('docked', 'stat:atk', 'u:cruiser')).toEqual({
      changed: true,
      hover: 'stat:atk',
    });
  });

  it('тот же объект перерисовки не просит — ни у курсора, ни в панели', () => {
    expect(nextHover('cursor', 'u:cruiser', 'u:cruiser').changed).toBe(false);
    expect(nextHover('docked', 'u:cruiser', 'u:cruiser').changed).toBe(false);
  });

  it('пустота поверх пустоты у курсора — тоже не перерисовка', () => {
    expect(nextHover('cursor', null, null)).toEqual({ changed: false, hover: null });
  });
});

describe('досье — тело', () => {
  it('ГОЛОЕ ИМЯ БЕЗ ТЕЛА — ТОЛЬКО ЗАГОЛОВОК: пустой блок это дырка в вёрстке', () => {
    expect(showsBody('')).toBe(false);
  });

  it('тело есть — рисуем', () => {
    expect(showsBody('<p>описание</p>')).toBe(true);
  });
});

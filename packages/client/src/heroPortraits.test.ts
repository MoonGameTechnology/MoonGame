import { describe, it, expect } from 'vitest';
import { heroPortraitHtml, portraitMarkup } from './heroPortraits';

describe('портреты героев', () => {
  it('герой из атласа — вырез клетки атласа, Учёный — свой векторный черновик', () => {
    expect(heroPortraitHtml('commander')).toContain('portraits');
    const scientist = heroPortraitHtml('scientist');
    expect(scientist).toContain('scientist');
    expect(scientist).not.toContain('portraits');
    // Черновик — квадрат целиком, а не четверть атласа.
    expect(scientist).toContain('width:100%');
    expect(heroPortraitHtml('nobody')).toBe('');
  });

  it('адрес с кавычками не рвёт атрибут: встроенный SVG приходит целым', () => {
    // Однофайловая сборка встраивает SVG как `data:`-URL с сырыми кавычками атрибутов.
    const url = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg">&amp;</svg>';
    const html = portraitMarkup(url);
    const src = /<img src="([^"]*)"/.exec(html)?.[1];
    expect(src?.replace(/&quot;/g, '"').replace(/&amp;/g, '&')).toBe(url);
  });
});

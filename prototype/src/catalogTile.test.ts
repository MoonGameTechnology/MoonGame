import { describe, it, expect } from 'vitest';
import { catalogTileHtml, tileLock, type TileView } from './catalogTile';

const tile = (over: Partial<TileView> = {}): string =>
  catalogTileHtml({
    kind: 'b',
    id: 'mine',
    icon: '<i>▣</i>',
    name: 'Шахта',
    label: '20❒',
    ...over,
  });

describe('плитка каталога — замок повторного заказа', () => {
  it('«уже стоит» и «уже заказано» — разные состояния', () => {
    expect(tileLock('E_ALREADY_BUILT')).toBe('built');
    expect(tileLock('E_ALREADY_QUEUED')).toBe('queued');
    expect(tileLock('E_ALREADY_PAUSED')).toBe('queued');
  });

  it('ГАСЯТ ТОЛЬКО коды повтора — нехватка денег плитку не запирает', () => {
    expect(tileLock('E_INSUFFICIENT')).toBeNull(); // цену с дефицитом показывает сама плитка
    expect(tileLock('E_BOMBARDED')).toBeNull();
    expect(tileLock('E_WRONG_SECTOR')).toBeNull();
    expect(tileLock('E_INTERNAL')).toBeNull();
  });

  it('без отказа плитка открыта', () => {
    expect(tileLock(null)).toBeNull();
    expect(tileLock(undefined)).toBeNull();
  });

  it('МЕСТНАЯ ОЧЕРЕДЬ прототипа тоже запирает — ядро о ней не знает', () => {
    expect(tileLock(null, true)).toBe('queued');
    expect(tileLock('E_INSUFFICIENT', true)).toBe('queued');
  });

  it('вердикт ядра сильнее местной очереди', () => {
    expect(tileLock('E_ALREADY_BUILT', true)).toBe('built');
  });
});

describe('плитка каталога — запертая', () => {
  it('ЗАКРЫТЫ ОБА ПУТИ ЗАКАЗА: ни карточки кодекса, ни правого клика', () => {
    const html = tile({ lock: 'built', orderable: true });
    expect(html).not.toContain('data-codex');
    expect(html).not.toContain('data-buildorder');
    expect(html).toContain('data-desc="b:mine"'); // досье по наведению остаётся
    expect(html).toContain('class="ptile locked"');
  });

  it('построенное и заказанное помечены по-разному', () => {
    expect(tile({ lock: 'built' })).toContain('✓');
    expect(tile({ lock: 'queued' })).toContain('⏳');
  });
});

describe('плитка каталога — открытая', () => {
  it('обычная плитка ведёт в кодекс, но правым кликом не заказывает', () => {
    const html = tile();
    expect(html).toContain('data-codex="b:mine"');
    expect(html).not.toContain('data-buildorder');
  });

  it('плитка меню стройки несёт приказ своего вида', () => {
    expect(tile({ orderable: true })).toContain('data-buildorder="building:mine"');
    expect(tile({ kind: 'u', id: 'cruiser', orderable: true })).toContain(
      'data-buildorder="unit:cruiser"',
    );
  });

  it('подпись и имя показываются', () => {
    const html = tile({ label: '20❒ 5⛁' });
    expect(html).toContain('20❒ 5⛁');
    expect(html).toContain('data-name="Шахта"');
  });
});

describe('плитка каталога — экранирование', () => {
  it('иконка вставляется как разметка, а имя и подпись — как текст (CWE-79)', () => {
    const html = tile({ icon: '<svg id="ic"></svg>', name: '<b>злое</b>', label: '<i>цена</i>' });
    expect(html).toContain('<svg id="ic">');
    expect(html).not.toContain('<b>злое</b>');
    expect(html).not.toContain('<i>цена</i>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('id уходит в атрибуты и тоже экранируется', () => {
    const html = tile({ id: '"><img src=x>', orderable: true });
    expect(html).not.toContain('<img src=x');
  });

  it('запертая плитка экранирует ровно так же', () => {
    const html = tile({ id: '"><img src=x>', name: '<b>x</b>', lock: 'queued' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
  });
});

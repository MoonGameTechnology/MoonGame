import { describe, it, expect } from 'vitest';
import {
  builtTileHtml,
  catalogRowHtml,
  catalogTileHtml,
  tileLock,
  type TileView,
} from './catalogTile';

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

describe('строка построенного здания', () => {
  const built = (over: Partial<Parameters<typeof builtTileHtml>[0]> = {}) =>
    builtTileHtml({ type: 'radar', level: 1, icon: '<i>⊚</i>', name: 'Radar Array', ...over });

  it('ИМЯ ПОДПИСАНО — одна иконка не отвечает на вопрос «что это»', () => {
    expect(built()).toContain('Radar Array');
  });

  it('ЭТО СТРОКА СПИСКА, А НЕ ПЛИТКА СЕТКИ: столбик не переносится и не растёт вширь', () => {
    expect(built()).toContain('class="asset-row built"');
    expect(built()).not.toContain('ptile');
  });

  it('иконка, имя и уровень идут одной строкой — уровень последний', () => {
    // `Radar Array` встречается и в атрибуте `data-name`, поэтому сравниваем позиции
    // ВИДИМОГО текста, а не первого вхождения подстроки.
    const html = built();
    expect(html.indexOf('bicon')).toBeLessThan(html.indexOf('<b>Radar Array</b>'));
    expect(html.indexOf('<b>Radar Array</b>')).toBeLessThan(html.indexOf('>L1<'));
  });

  it('УРОВЕНЬ ПОКАЗАН ВСЕГДА, даже у здания без апгрейдов', () => {
    expect(built()).toContain('L1');
    expect(built({ level: 3 })).toContain('L3');
    expect(built()).not.toContain('✓'); // галочка читалась как «готово», а не как уровень
  });

  it('строка ведёт в кодекс с текущим уровнем', () => {
    expect(built({ level: 2 })).toContain('data-codex="b:radar:2"');
    expect(built({ level: 2 })).toContain('data-desc="b:radar:2"');
  });

  it('построенное НЕ заказывается повторно — якоря заказа нет', () => {
    expect(built()).not.toContain('data-buildorder');
  });

  it('иконка вставляется разметкой, имя — текстом (CWE-79)', () => {
    const html = built({ icon: '<svg id="ic"></svg>', name: '<b>злое</b>' });
    expect(html).toContain('<svg id="ic">');
    expect(html).not.toContain('<b>злое</b>');
  });

  it('id здания экранируется — он уходит в атрибуты', () => {
    expect(built({ type: '"><img src=x>' })).not.toContain('<img src=x');
  });

  it('ДОХОД ПОКАЗАН — ради него в этот список и смотрят; стоит ПЕРЕД уровнем', () => {
    const html = built({ income: '<span class="rcost">+20</span>' });
    expect(html).toContain('class="prod"');
    expect(html).toContain('+20');
    expect(html.indexOf('class="prod"')).toBeLessThan(html.indexOf('>L1<'));
  });

  it('недоходное здание не печатает пустую колонку', () => {
    expect(built()).not.toContain('class="prod"');
    expect(built({ income: '' })).not.toContain('class="prod"');
  });
});

describe('строка каталога', () => {
  const row = (over: Partial<TileView> = {}): string =>
    catalogRowHtml({
      kind: 'u',
      id: 'cruiser',
      icon: '<i>▲</i>',
      name: 'Крейсер',
      label: '20❒',
      ...over,
    });

  it('ЭТО СТРОКА, А НЕ ПЛИТКА: та же подача, что у списка построенного', () => {
    expect(row()).toContain('class="asset-row cat"');
    expect(row()).not.toContain('ptile');
  });

  it('ИМЯ ПОДПИСАНО и цена стоит рядом — тапать ради опознания больше не нужно', () => {
    const html = row();
    expect(html).toContain('<b>Крейсер</b>');
    expect(html.indexOf('<b>Крейсер</b>')).toBeLessThan(html.indexOf('20❒'));
  });

  it('ПРАВИЛА ЗАКАЗА ТЕ ЖЕ, ЧТО У ПЛИТКИ: оба якоря на месте', () => {
    const html = row({ orderable: true });
    expect(html).toContain('data-codex="u:cruiser"');
    expect(html).toContain('data-buildorder="unit:cruiser"');
    expect(html).toContain('data-desc="u:cruiser"'); // сводка по удержанию
  });

  it('ЗАПЕРТАЯ СТРОКА теряет ОБА пути заказа, сохраняя досье', () => {
    const html = row({ kind: 'b', id: 'mine', lock: 'built', orderable: true });
    expect(html).not.toContain('data-codex');
    expect(html).not.toContain('data-buildorder');
    expect(html).toContain('data-desc="b:mine"');
    expect(html).toContain('class="asset-row cat locked"');
    expect(html).toContain('✓');
    expect(row({ lock: 'queued' })).toContain('⏳');
  });

  it('иконка вставляется разметкой, а имя и подпись — текстом (CWE-79)', () => {
    const html = row({ icon: '<svg id="ic"></svg>', name: '<b>злое</b>', label: '<i>цена</i>' });
    expect(html).toContain('<svg id="ic">');
    expect(html).not.toContain('<b>злое</b>');
    expect(html).not.toContain('<i>цена</i>');
  });

  it('id экранируется в обоих состояниях — он уходит в атрибуты', () => {
    expect(row({ id: '"><img src=x>', orderable: true })).not.toContain('<img src=x');
    expect(row({ id: '"><img src=x>', lock: 'built' })).not.toContain('<img src=x');
  });
});

import { describe, it, expect } from 'vitest';
import { actionButton, block, cardHeader, pcols, tabButton, unitRows } from './panelKit';

const view = (unit: string) => ({
  icon: `<i>${unit}</i>`,
  name: unit.toUpperCase(),
  domain: 'космос',
});

describe('панель — кнопка действия', () => {
  it('несёт действие и аргумент', () => {
    const html = actionButton('build', 'mine', 'Строить', true);
    expect(html).toContain('data-act="build"');
    expect(html).toContain('data-arg="mine"');
    expect(html).toContain('Строить');
  });

  it('НЕДОСТУПНАЯ кнопка остаётся видимой, но disabled', () => {
    const off = actionButton('build', 'mine', 'Строить', false);
    expect(off).toContain('disabled');
    expect(off).toContain('Строить'); // не спрятана — игрок видит, что действие есть
    expect(actionButton('build', 'mine', 'Строить', true)).not.toContain('disabled');
  });

  it('досье цепляется только когда его передали', () => {
    expect(actionButton('a', 'b', 'c', true, 'u:cruiser')).toContain('data-desc="u:cruiser"');
    expect(actionButton('a', 'b', 'c', true)).not.toContain('data-desc');
  });

  it('ВСЕ значения экранируются — они уходят в innerHTML (CWE-79)', () => {
    const html = actionButton('a"x', '"><img src=x>', '<b>жирный</b>', true, '"onload=1');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>жирный</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('панель — колонки', () => {
  it('каждая секция оборачивается в свой блок', () => {
    expect(block('тело')).toBe('<div class="block">тело</div>');
  });

  it('колонки собирают все секции по порядку', () => {
    const html = pcols(['раз', 'два']);
    expect(html.indexOf('раз')).toBeLessThan(html.indexOf('два'));
    expect(html.match(/class="block"/g)).toHaveLength(2);
  });

  it('пустой набор секций даёт пустое тело, а не мусор', () => {
    expect(pcols([])).toBe('<div class="pcols"></div>');
  });
});

describe('панель — шапка карточки', () => {
  it('несёт имя, подпись, цвет стороны и крестик', () => {
    const html = cardHeader('#0ff', 'Мир C1R1', 'нейтральный · 3 постройки');
    expect(html).toContain('Мир C1R1');
    expect(html).toContain('background:#0ff');
    expect(html).toContain('data-act="close"');
  });

  it('КОМПАКТНАЯ шапка ужимает разделители — иначе подпись обрезается', () => {
    const airy = cardHeader('#0ff', 'X', 'a · b · c');
    const tight = cardHeader('#0ff', 'X', 'a · b · c', { compact: true });
    expect(airy).toContain('a · b · c');
    expect(tight).toContain('a·b·c');
  });

  it('имя становится кнопкой только когда карточка передала действие', () => {
    expect(cardHeader('#0ff', 'X', 's', { titleAct: 'fleetinfo' })).toContain('ptitle-btn');
    expect(cardHeader('#0ff', 'X', 's')).not.toContain('ptitle-btn');
  });

  it('имя и подпись экранируются', () => {
    const html = cardHeader('#0ff', '<img src=x>', '<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
});

describe('панель — вкладки', () => {
  it('активная вкладка помечена, остальные — нет', () => {
    expect(tabButton('buildings', 'Постройки', 3, true)).toContain('class="ptab on"');
    expect(tabButton('units', 'Войска', 0, false)).toContain('class="ptab"');
  });

  it('счётчик показывается даже нулевым — пустая вкладка это тоже факт', () => {
    expect(tabButton('units', 'Войска', 0, false)).toContain('<b>0</b>');
  });

  it('вкладка несёт своё имя в аргументе и экранирует его', () => {
    expect(tabButton('buildings', 'П', 1, false)).toContain('data-arg="buildings"');
    expect(tabButton('"><img>', 'П', 1, false)).not.toContain('<img>');
  });
});

describe('панель — строки состава', () => {
  const stacks = [
    { unit: 'cruiser', count: 2 },
    { unit: 'scout', count: 1 },
  ];

  it('каждая строка несёт количество, имя и досье юнита', () => {
    const html = unitRows(stacks, view, 'никого');
    expect(html).toContain('2× CRUISER');
    expect(html).toContain('data-desc="u:cruiser"');
    expect(html.match(/asset-row/g)).toHaveLength(2);
  });

  it('ПУСТОЙ состав говорит словами, а не пустотой', () => {
    const html = unitRows([], view, 'никого');
    expect(html).toContain('никого');
    expect(html).not.toContain('asset-row');
  });

  it('иконка вставляется как разметка, а имя — как текст', () => {
    const html = unitRows(
      [{ unit: 'x', count: 1 }],
      () => ({
        icon: '<svg id="ic"></svg>',
        name: '<b>злое</b>',
        domain: 'земля',
      }),
      'никого',
    );
    expect(html).toContain('<svg id="ic">'); // иконку рисуем
    expect(html).not.toContain('<b>злое</b>'); // имя из данных — только текстом
  });

  it('порядок строк сохраняется', () => {
    const html = unitRows(stacks, view, 'никого');
    expect(html.indexOf('CRUISER')).toBeLessThan(html.indexOf('SCOUT'));
  });

  it('СТРОКА СОСТАВА — КНОПКА, как строка здания: по ней есть куда нажать', () => {
    const html = unitRows(stacks, view, 'никого');
    expect(html).toContain('<button class="asset-row unit"');
    expect(html).not.toContain('<div class="asset-row"');
  });

  it('ТАП ВЕДЁТ В КАРТОЧКУ, УДЕРЖАНИЕ ПОКАЗЫВАЕТ ИМЯ — те же якоря, что у зданий', () => {
    const html = unitRows(stacks, view, 'никого');
    expect(html).toContain('data-codex="u:cruiser"');
    expect(html).toContain('data-name="CRUISER"');
  });

  it('список идёт ОДНИМ СТОЛБИКОМ — тем же контейнером, что у зданий', () => {
    expect(unitRows(stacks, view, 'никого')).toContain('<div class="blist">');
  });

  it('пустой состав столбика не заводит — сообщать нечего', () => {
    expect(unitRows([], view, 'никого')).not.toContain('blist');
  });

  it('имя из данных не протекает в якорь удержания', () => {
    const html = unitRows([{ unit: 'x', count: 1 }], () => ({ icon: '', name: '"><b>злое', domain: 'з' }), 'никого');
    expect(html).not.toContain('data-name=""><b>злое"');
  });
});

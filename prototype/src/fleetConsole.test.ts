import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  statGridHtml,
  statPopHtml,
  troopTableHtml,
  vitalsHtml,
  type StatPopView,
  type VitalView,
} from './fleetConsole';

beforeAll(() => setLocale('ru'));

const hull: VitalView = { stat: 'hull', label: 'Корпус', value: '312/312', pct: 100, low: false, tone: 'neutral' };

describe('окно флота — шапка', () => {
  it('корпус и щит — кнопки всплывашки со своим параметром', () => {
    const html = vitalsHtml([hull, { ...hull, stat: 'shield', label: 'Щит', value: '40/80', pct: 50 }]);
    expect(html).toContain('data-stat="hull"');
    expect(html).toContain('data-stat="shield"');
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(html).toContain('style="width:50%"');
  });

  it('щита нет — значение есть, полосы нет (пустая читалась бы как «сбит»)', () => {
    const html = vitalsHtml([{ ...hull, stat: 'shield', value: 'нет', pct: null }]);
    expect(html).toContain('>нет</b>');
    expect(html).not.toContain('fc-bar');
  });

  it('цвет значения — по тону, хромота — по порогу, ремонт — за полосами', () => {
    const html = vitalsHtml([{ ...hull, tone: 'debuff', low: true, pct: 140 }], '<button>🔧</button>');
    expect(html).toContain('class="fc-vital hull low"');
    expect(html).toContain('class="fc-vv debuff"');
    expect(html).toContain('style="width:100%"'); // полоса не вылезает за край
    expect(html).toContain('<span class="fc-repair"><button>🔧</button></span>');
  });
});

describe('окно флота — «Состав»', () => {
  it('параметр — кнопка с тоном; нейтральный класса тона не несёт', () => {
    const html = statGridHtml([
      { stat: 'atk', icon: 'sword', label: 'Атака', value: '75', tone: 'buff' },
      { stat: 'cap', icon: 'stack', label: 'Линия <огня>', value: '4/10', tone: 'neutral' },
    ]);
    expect(html).toContain('class="fc-stat buff" data-stat="atk"');
    expect(html).toContain('class="fc-stat" data-stat="cap"');
    expect(html).toContain('Линия &lt;огня&gt;');
  });
});

describe('окно флота — «Десант»', () => {
  const rows = [{ icon: '<i></i>', name: 'Ополчение', planet: 3, aboard: 0 }];

  it('у своего мира — три колонки', () => {
    const html = troopTableHtml(rows, true);
    expect(html).toContain(`<th>${t('fleet.console.at-planet')}</th>`);
    expect(html).toContain('<td>3</td><td>0</td>');
  });

  it('вне своего мира колонки «На планете» нет вовсе', () => {
    const html = troopTableHtml([{ ...rows[0]!, planet: null }], false);
    expect(html).not.toContain(t('fleet.console.at-planet'));
    expect(html).toContain('Ополчение</td><td>0</td>');
  });

  it('некого показывать — нет и таблицы', () => {
    expect(troopTableHtml([], true)).toBe('');
  });
});

describe('окно флота — всплывашка надбавок', () => {
  const view: StatPopView = {
    title: 'Атака',
    value: '75',
    tone: 'buff',
    desc: '',
    base: '53',
    rows: [
      { label: 'Сектор', pct: 25 },
      { label: 'Хромота', pct: -10 },
    ],
    total: 12.5,
  };

  it('база, строки источников и итог; бафы зелёные, дебафы красные', () => {
    const html = statPopHtml(view);
    expect(html).toContain('<span class="sp-val buff">75</span>');
    expect(html).toContain(`<span>${t('stat.pop.base')}</span><b>53</b>`);
    expect(html).toContain('<div class="sp-row buff"><span>Сектор</span><b>+25%</b>');
    expect(html).toContain('<div class="sp-row debuff"><span>Хромота</span><b>−10%</b>');
    expect(html).toContain(`<div class="sp-row total buff"><span>${t('stat.pop.total')}</span>`);
  });

  it('входящий урон: меньше — лучше, цвета строк обратные', () => {
    const html = statPopHtml({ ...view, lessIsBetter: true, sub: t('stat.pop.incoming') });
    expect(html).toContain('<div class="sp-row debuff"><span>Сектор</span>');
    expect(html).toContain('<div class="sp-row buff"><span>Хромота</span>');
    expect(html).toContain(`<div class="sp-sub">${t('stat.pop.incoming')}</div>`);
  });

  it('надбавок нет — так и сказано, итога нет', () => {
    const html = statPopHtml({ ...view, rows: [], total: 0 });
    expect(html).toContain(t('stat.pop.none'));
    expect(html).not.toContain(t('stat.pop.total'));
  });

  it('параметр без надбавок по природе — только правило', () => {
    const html = statPopHtml({ ...view, desc: 'Бьют десять стволов.', plain: true });
    expect(html).toContain('<p class="sp-desc">Бьют десять стволов.</p>');
    expect(html).not.toContain('sp-row');
    expect(html).not.toContain(t('stat.pop.none'));
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  esc,
  kfmt,
  nfmt,
  round1,
  hl,
  TECH_CUR,
  curIc,
  cost,
  costText,
  displayUnit,
  buildingName,
  fmtEta,
} from './format';

// REFM-2: the first tests over code that used to live inside `main.ts` — 15k lines
// with zero exports and zero test coverage. Every brick that lands here from now on
// arrives testable, which is half the point of the split.
//
// The locale is pinned: under Node there is no browser language to detect, so the
// runtime falls back to EN and «Крейсер» would read «cruiser». Pinning RU keeps the
// name assertions meaningful (a real lookup, not the pass-through of a missed key).
beforeAll(() => setLocale('ru'));

describe('format — экранирование (CWE-79)', () => {
  it('закрывает и текст, и оба вида кавычек в атрибутах', () => {
    expect(esc('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(esc("it's & <b>")).toBe('it&#39;s &amp; &lt;b&gt;');
  });

  it('амперсанд экранируется первым — иначе выйдет двойное экранирование', () => {
    // '&' → '&amp;' должен произойти ДО '<' → '&lt;', иначе получится '&amp;lt;'
    expect(esc('<')).toBe('&lt;');
    expect(esc('&lt;')).toBe('&amp;lt;'); // уже экранированный текст экранируется честно
  });

  it('чистая строка проходит без изменений', () => {
    expect(esc('Носорог-1 · День 3')).toBe('Носорог-1 · День 3');
  });
});

describe('format — числа', () => {
  it('kfmt сокращает от тысячи и роняет хвостовой ноль', () => {
    expect(kfmt(999)).toBe('999');
    expect(kfmt(1000)).toBe('1k'); // не «1.0k»
    expect(kfmt(1240)).toBe('1.2k');
    expect(kfmt(-1500)).toBe('-1.5k'); // долг тоже сокращается
    expect(kfmt(12.4)).toBe('12'); // округляет до целого
  });

  it('nfmt группирует разряды (карточки досье/профиля)', () => {
    // разделитель разрядов у Intl — неразрывный пробел (в разных версиях ICU
    // обычный NBSP или узкий), поэтому нормализуем любой пробельный символ
    expect(nfmt(1234567).replace(/\s/g, ' ')).toBe('1 234 567');
  });

  it('round1 держит один знак — медленная утечка не округляется в лживый ноль', () => {
    expect(round1(-0.44)).toBe(-0.4);
    expect(round1(0.06)).toBe(0.1);
    expect(round1(5)).toBe(5);
  });
});

describe('format — ресурсы', () => {
  it('cost отдаёт чипы: ТОТ ЖЕ SVG, что в баре, + подкраска по ресурсу', () => {
    const one = cost({ metal: 80 });
    expect(one).toContain('class="rcost rc-metal"');
    expect(one).toContain('<svg'); // единая иконка бара, не текстовый глиф
    expect(one).toContain('>80<');
    expect(one).not.toContain('❒'); // старый глиф в innerHTML-поверхностях умер
    const two = cost({ metal: 80, credits: 20 });
    expect(two).toContain('rc-metal');
    expect(two).toContain('rc-credits');
  });

  it('cost с казной красит нехватку и называет точный дефицит', () => {
    // Казна 50 металла из 80 и 25 кредитов из 20: металл — красный с «−30»,
    // кредиты — обычный чип (хватает).
    const html = cost({ metal: 80, credits: 20 }, { metal: 50, credits: 25 });
    expect(html).toContain('rcost rc-metal short');
    expect(html).toContain('>−30</em>');
    expect(html).toContain('не хватает 30'); // подсказка с локализованным дефицитом
    expect(html).not.toContain('rc-credits short');
    // Без казны нехватка не рисуется вовсе — нейтральный ценник.
    expect(cost({ metal: 80 })).not.toContain('short');
  });

  it('нехватка отсутствующего в казне ресурса — вся цена целиком', () => {
    expect(cost({ microelectronics: 5 }, { metal: 999 })).toContain('>−5</em>');
  });

  it('costText отдаёт ЧИСТЫЙ текст — для title и подписей через esc()', () => {
    // Именно этот разъезд однажды уехал в прод: cost() в title показывал игроку
    // сырую разметку вместо цифр.
    expect(costText({ metal: 80, credits: 20 })).toBe('80❒ 20⛁');
    expect(costText({ metal: 80 })).not.toContain('<');
  });

  it('пустой мешок и его отсутствие читаются как «бесплатно» — ключом, не литералом', () => {
    expect(cost(undefined)).toContain('бесплатно');
    expect(cost({})).toContain('бесплатно');
    expect(costText(undefined)).toBe('бесплатно');
  });

  it('незнакомый ресурс не роняет строку — берётся первая буква имени', () => {
    expect(costText({ unobtainium: 3 })).toBe('3u');
    expect(curIc('unobtainium')).toContain('rc-unobtainium');
    expect(curIc('unobtainium')).not.toContain('<svg');
  });

  it('у всех пяти сессионных ресурсов есть глиф', () => {
    for (const r of ['credits', 'food', 'metal', 'energy', 'microelectronics']) {
      expect(TECH_CUR[r], r).toBeTruthy();
    }
  });
});

describe('format — имена и время', () => {
  it('displayUnit разбирает id в имя ДАННЫХ (подчёркивания → пробелы)', () => {
    // ключ строится из имени, поэтому подчёркивание обязано стать пробелом:
    // 'strike_carrier' → 'strike carrier' → data.strike-carrier
    expect(displayUnit('strike_carrier')).toBe('ударный носитель');
    expect(displayUnit('cruiser')).toBe('крейсер');
  });

  it('buildingName берёт имя из данных, а без него — сам id (fail-soft)', () => {
    expect(buildingName('Metal Mine', 'mine')).toBe('Металлодобыча');
    // подчёркивания НЕ трогает — это работа displayUnit(); тут id уходит как есть
    expect(buildingName(undefined, 'mystery_hall')).toBe('mystery_hall');
  });

  it('fmtEta переключается с часов на минуты под часом', () => {
    expect(fmtEta(2.5)).toContain('2.5');
    expect(fmtEta(0.5)).toContain('30'); // 0.5 ч → 30 мин
    expect(fmtEta(0.01)).toContain('1'); // округляется вверх, не в «0 мин»
  });

  it('hl оборачивает значение в подсветку досье', () => {
    expect(hl(42)).toBe('<em class="hl">42</em>');
  });
});

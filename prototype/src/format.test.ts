import { readFileSync } from 'node:fs';
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
  resChip,
  resLine,
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

// UI-RES2: ресурс НИГДЕ не печатается голым словом — одно правило на все
// поверхности (ценник уже такой, теперь и выработка/содержание/доход).
describe('чипы ресурса — одно правило на все поверхности', () => {
  it('чип несёт ту же иконку и тот же класс цвета, что ценник и капсула бара', () => {
    const chip = resChip('metal', 12);
    expect(chip).toContain('rcost rc-metal');
    expect(chip).toContain('<svg'); // общая SVG-иконка, не глиф и не слово
    expect(chip).not.toContain('металл'); // имя ресурса словом больше не печатается
  });

  it('поток помечается знаком, запас — нет', () => {
    expect(resChip('metal', 12, { sign: true })).toContain('+12');
    expect(resChip('energy', -8, { sign: true })).toContain('−8'); // типографский минус
    expect(resChip('metal', 12)).not.toContain('+');
  });

  it('суффикс скорости приходит из локали, а не зашит в код', () => {
    expect(resChip('metal', 12, { per: 'h' })).toContain('/ч');
    expect(resChip('credits', 6, { per: 'd' })).toContain('/д');
    expect(resChip('metal', 12)).not.toContain('rc-per');
  });

  it('дробное округляется до десятой — как в прежней текстовой форме', () => {
    expect(resChip('metal', 10.44)).toContain('10.4');
  });

  it('мешок: нули опускаются, пустой мешок — пустая строка', () => {
    expect(resLine({})).toBe('');
    expect(resLine({ metal: 0 })).toBe('');
    const two = resLine({ metal: 10.44, credits: 3 }, { sign: true, per: 'h' });
    expect(two).toContain('rc-metal');
    expect(two).toContain('rc-credits');
    expect(two).toContain('+10.4');
  });

  it('незнакомый ресурс не ломает строку — иконкой становится буква имени', () => {
    const chip = resChip('нет-такого', 5);
    expect(chip).toContain('rc-нет-такого');
    expect(chip).toContain('5');
  });
});

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

// Сторож правила, а не отдельного места: ресурс не должен снова начать печататься
// СЛОВОМ. Скан по исходникам экранов — потому что «забыл про одну поверхность» это
// ровно тот способ, которым правило и разъезжается (так уже было с ценниками).
describe('UI-RES2 — сторож: ресурс не печатается словом', () => {
  const SRC = ['dossiers.ts', 'buildScreen.ts', 'main.ts', 'techTree.ts', 'marketScreen.ts'];
  const read = (f: string): string => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

  it('никто не собирает строку выработки/содержания вручную через tData(ресурс)', () => {
    // Признак старой формы: подстановка имени ресурса рядом с «/ч» или «/день».
    for (const f of SRC) {
      const src = read(f);
      expect(src, f).not.toMatch(/tData\(res\)/);
      expect(src, f).not.toMatch(/\{ n: n \?\? 0, r: tData\(/);
    }
  });

  it('удалённые текстовые ключи не вернулись', () => {
    // codex.value.per-hour/-day печатали «{n} {r}/ч» словом; producesLine — тоже.
    for (const f of SRC) {
      const src = read(f);
      expect(src, f).not.toContain('codex.value.per-hour');
      expect(src, f).not.toContain('codex.value.per-day');
      expect(src, f).not.toContain('producesLine');
    }
  });

  it('утренний отчёт «Хранителя» не печатает ресурсы словом и не собирается в коде', () => {
    // Найдено этим же проходом: строка «Пока вы спали: … металл +N, кредиты +M»
    // была РУССКОЙ ПРОЗОЙ прямо в main.ts — англоязычный игрок читал её по-русски.
    // Тост идёт textContent (в ленту попадает и чужой текст), HTML-чип невозможен,
    // поэтому ресурс несёт свой глиф; сама фраза уехала в локаль.
    const src = read('main.ts');
    expect(src).not.toContain('Пока вы спали');
    expect(src).toContain("t('log.steward.diff'");
  });

  it('базовый выход мира идёт чипом БЕЗ отката на слово', () => {
    // Прежняя форма «TECH_CUR[r] ? curIc(r) : tData(r)» падала на слово ровно там,
    // где у игрока нет опоры — у ресурса без глифа.
    expect(read('main.ts')).not.toMatch(/TECH_CUR\[r\] \? curIc\(r\)/);
  });
});

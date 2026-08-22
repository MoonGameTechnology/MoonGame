import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FIRE_MODE,
  FIRE_MODE_IDS,
  fireMenuHtml,
  fireModeLabel,
  fireModeTargets,
} from './fireMode';

const флот = (
  over: Partial<{ id: string; owner: string; artillery: boolean; mode: string | null }> = {},
) => ({ id: 'f1', owner: 'me', artillery: true, mode: 'standard', ...over });

describe('режим огня — набор режимов', () => {
  it('ЧЕТЫРЕ РЕЖИМА И ВСЕ РАЗНЫЕ: меню стоячих правил не терпит дублей', () => {
    expect(FIRE_MODE_IDS.length).toBe(4);
    expect(new Set(FIRE_MODE_IDS).size).toBe(4);
  });

  it('ДЕФОЛТ — ОДИН НА ВЕСЬ КЛИЕНТ: подпись и отправка обязаны считать одинаково', () => {
    expect(FIRE_MODE_IDS).toContain(DEFAULT_FIRE_MODE);
  });

  it('КЛЮЧИ ЛОКАЛИ — ЛИТЕРАЛАМИ: собранный из id ключ невидим гейту осиротевших переводов', () => {
    const src = readFileSync(new URL('./fireMode.ts', import.meta.url), 'utf8');
    for (const m of FIRE_MODE_IDS) {
      expect(src).toContain(`'cmd.fire.${m}'`);
      expect(src).toContain(`'cmd.fire.${m}.hint'`);
    }
    // интерполяция ключа — ровно то, что гейт не увидит
    expect(src).not.toMatch(/t\(`cmd\.fire\./);
  });
});

describe('режим огня — подпись кнопки', () => {
  it('ЕДИНОГЛАСИЕ — ИМЯ РЕЖИМА: по подписи видно, надо ли вообще открывать меню', () => {
    for (const m of FIRE_MODE_IDS) {
      const l = fireModeLabel(m);
      expect(l.length).toBeGreaterThan(0);
      expect(l).not.toBe(fireModeLabel(null));
    }
  });

  it('РАЗНОБОЙ — НЕЙТРАЛЬНАЯ ПОДПИСЬ: показать чей-то один режим значит соврать про остальных', () => {
    expect(fireModeLabel(null)).toBe(fireModeLabel(null));
    expect(fireModeLabel(null).length).toBeGreaterThan(0);
  });

  it('незнакомый режим не роняет подпись — она откатывается к нейтральной', () => {
    expect(fireModeLabel('нет-такого')).toBe(fireModeLabel(null));
  });

  it('подписи у всех четырёх различаются — иначе кнопка не различает состояния', () => {
    const все = FIRE_MODE_IDS.map((m) => fireModeLabel(m));
    expect(new Set(все).size).toBe(4);
  });
});

describe('режим огня — меню', () => {
  it('ПУНКТ НА КАЖДЫЙ РЕЖИМ, У КАЖДОГО СВОЁ ПРАВИЛО ВТОРОЙ СТРОКОЙ', () => {
    const html = fireMenuHtml('standard');
    for (const m of FIRE_MODE_IDS) expect(html).toContain(`data-mode="${m}"`);
    expect((html.match(/<span>/g) ?? []).length).toBe(4);
  });

  it('ТЕКУЩИЙ ПОМЕЧЕН: меню стоячих правил обязано показать, какое в силе', () => {
    const html = fireMenuHtml('return');
    expect(html).toContain('●');
    expect(html).toMatch(/data-mode="return"[^>]*class="on"/);
  });

  it('при разнобое не помечен НИ ОДИН — общего режима у выделения нет', () => {
    const html = fireMenuHtml(null);
    expect(html).not.toContain('●');
    expect(html).not.toContain('class="on"');
  });
});

describe('режим огня — кому уходит приказ', () => {
  it('ТОЛЬКО ТЕМ, У КОГО РЕЖИМ ДРУГОЙ: приказ — это круг через ядро с квитанцией', () => {
    const ids = fireModeTargets(
      [флот({ id: 'a', mode: 'standard' }), флот({ id: 'b', mode: 'passive' })],
      'me',
      'standard',
    );
    expect(ids).toEqual(['b']);
  });

  it('ЧУЖОЙ ФЛОТ НЕ ПОЛУЧАЕТ ПРИКАЗА', () => {
    expect(fireModeTargets([флот({ id: 'a', owner: 'враг', mode: 'passive' })], 'me', 'standard'))
      .toEqual([]);
  });

  it('БЕЗ АРТИЛЛЕРИИ РЕЖИМА ОГНЯ НЕТ — такой флот пропускается', () => {
    expect(
      fireModeTargets([флот({ id: 'a', artillery: false, mode: 'passive' })], 'me', 'standard'),
    ).toEqual([]);
  });

  it('ПУСТОЙ РЕЖИМ СЧИТАЕТСЯ ДЕФОЛТНЫМ: иначе флот без поля вечно получал бы приказ', () => {
    expect(fireModeTargets([флот({ id: 'a', mode: null })], 'me', DEFAULT_FIRE_MODE)).toEqual([]);
    expect(fireModeTargets([флот({ id: 'a', mode: null })], 'me', 'passive')).toEqual(['a']);
  });

  it('порядок сохраняется, отбор не мутирует вход', () => {
    const вход = [флот({ id: 'a', mode: 'passive' }), флот({ id: 'b', mode: 'return' })];
    expect(fireModeTargets(вход, 'me', 'standard')).toEqual(['a', 'b']);
    expect(вход.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

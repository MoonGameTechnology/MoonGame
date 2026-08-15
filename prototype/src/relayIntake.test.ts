import { describe, expect, it } from 'vitest';
import { pingRoute, relayIntake } from './relayIntake';

describe('ретранслированная строка ленты', () => {
  it('новая и показуемая — берём', () => {
    expect(relayIntake({ known: false, showable: true })).toBe('add');
  });

  it('СВОЁ ЭХО НЕ УДВАИВАЕТ СТРОКУ: эхо приходит и автору, а вход переигрывает историю', () => {
    expect(relayIntake({ known: true, showable: true })).toBe('skip-duplicate');
  });

  it('ПОКАЗАТЬ НЕЧЕМ — НЕ БЕРЁМ: метка без провинции не нарисуется нигде', () => {
    expect(relayIntake({ known: false, showable: false })).toBe('skip-unshowable');
  });

  it('нечем показать — важнее, чем «уже знаем»: мусор не попадает в ленту ни в каком виде', () => {
    expect(relayIntake({ known: true, showable: false })).toBe('skip-unshowable');
  });
});

describe('куда уходит своя метка', () => {
  it('В СЕТИ — СЕРВЕРУ: строку в ленту положит его эхо, id у всех один', () => {
    expect(pingRoute(true, true)).toBe('server');
  });

  it('соло — своя лента и есть истина', () => {
    expect(pingRoute(false, false)).toBe('local');
    expect(pingRoute(false, true)).toBe('local');
  });

  it('сетевой матч без живого транспорта — отправлять некуда, ставим локально', () => {
    expect(pingRoute(true, false)).toBe('local');
  });
});

import { describe, expect, it } from 'vitest';
import { diploIntent, type ClickTarget } from './diploClick';

/** Клик по кнопке с этими классами и атрибутами (DOM не нужен — как в тестах меток). */
function клик(кнопки: Array<{ sel: string; dataset: Record<string, string> }>): ClickTarget {
  return {
    closest: (sel) => кнопки.find((b) => b.sel === sel) ?? null,
  };
}

describe('разбор дипломатического клика', () => {
  it('предложение позиции: место и позиция берутся с самой кнопки', () => {
    const tg = клик([{ sel: '.dp-act', dataset: { seat: 'p2', stance: 'war' } }]);
    expect(diploIntent(tg)).toEqual({ kind: 'stance', seat: 'p2', stance: 'war' });
  });

  it('ОБМЕН КАРТОЙ ЧИТАЕТ СВОЙ АТРИБУТ: у него `mapseat`, а не `seat` (правило 2)', () => {
    const tg = клик([{ sel: '.dp-map', dataset: { mapseat: 'p3' } }]);
    expect(diploIntent(tg)).toEqual({ kind: 'map', seat: 'p3' });
  });

  it('шпион несёт и место, и вид операции', () => {
    const tg = клик([{ sel: '.dp-spy', dataset: { seat: 'p4', spy: 'fleets' } }]);
    expect(diploIntent(tg)).toEqual({ kind: 'spy', seat: 'p4', what: 'fleets' });
  });

  it('письмо: место из `msgseat`', () => {
    const tg = клик([{ sel: '.dp-msg', dataset: { msgseat: 'p5' } }]);
    expect(diploIntent(tg)).toEqual({ kind: 'message', seat: 'p5' });
  });

  it('ПЕРВОЕ СОВПАДЕНИЕ ВЫИГРЫВАЕТ: иначе один клик сделает два действия (правило 3)', () => {
    const tg = клик([
      { sel: '.dp-act', dataset: { seat: 'p2', stance: 'peace' } },
      { sel: '.dp-spy', dataset: { seat: 'p2', spy: 'treasury' } },
      { sel: '.dp-msg', dataset: { msgseat: 'p2' } },
    ]);
    expect(diploIntent(tg)?.kind).toBe('stance');
  });

  it('порядок проверок: позиция → карта → шпион → письмо', () => {
    const без = (кроме: string) =>
      клик(
        (
          [
            { sel: '.dp-act', dataset: { seat: 'p1', stance: 'peace' } },
            { sel: '.dp-map', dataset: { mapseat: 'p1' } },
            { sel: '.dp-spy', dataset: { seat: 'p1', spy: 'treasury' } },
            { sel: '.dp-msg', dataset: { msgseat: 'p1' } },
          ] as Array<{ sel: string; dataset: Record<string, string> }>
        ).filter((b) => !кроме.includes(b.sel)),
      );
    expect(diploIntent(без('.dp-act'))?.kind).toBe('map');
    expect(diploIntent(без('.dp-act.dp-map'))?.kind).toBe('spy');
    expect(diploIntent(без('.dp-act.dp-map.dp-spy'))?.kind).toBe('message');
  });

  it('НЕ ДИПЛОМАТИЧЕСКАЯ КНОПКА — НЕТ НАМЕРЕНИЯ: экран продолжит свой разбор (правило 4)', () => {
    expect(diploIntent(клик([]))).toBeNull();
    expect(diploIntent(клик([{ sel: '.dp-fclear', dataset: {} }]))).toBeNull();
  });

  it('кнопка письма без места намерением не считается', () => {
    expect(diploIntent(клик([{ sel: '.dp-msg', dataset: {} }]))).toBeNull();
  });
});

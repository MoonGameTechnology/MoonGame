import { describe, expect, it } from 'vitest';
import { diploDelivery, type DiploKind } from './diploDelivery';

describe('правило 1 — война называется своим текстом', () => {
  it('стойка «война» — отдельный ключ и без подстановки стойки', () => {
    const d = diploDelivery('stance', 'war', 'p2');
    expect(d.noteKey).toBe('comms.war-declared');
    expect(d.noteNeedsStance).toBe(false);
  });
  it.each(['peace', 'pact', 'alliance'])('стойка «%s» — общий текст со стойкой', (st) => {
    const d = diploDelivery('stance', st, 'p2');
    expect(d.noteKey).toBe('comms.stance-changed');
    expect(d.noteNeedsStance).toBe(true);
  });
  it('война в ПРЕДЛОЖЕНИИ отдельным текстом НЕ называется — воевать ещё не начали', () => {
    expect(diploDelivery('offer-in', 'war', 'p2').noteKey).toBe('log.diplo.offer');
    expect(diploDelivery('offer-out', 'war', 'p2').noteKey).toBe('log.diplo.sent');
  });
});

describe('правило 2 — сдвиг и входящее предложение идут в три места', () => {
  it.each(['stance', 'offer-in'] as const)('%s: лента + тред + непрочитанное', (kind) => {
    const d = diploDelivery(kind, 'peace', 'p2');
    expect(d.noteKey).toBeTruthy();
    expect(d.message).not.toBeNull();
    expect(d.unread).toBe(true);
  });
});

describe('правило 3 — своё исходящее только в ленту', () => {
  it('в тред не пишется и непрочитанным не считается', () => {
    const d = diploDelivery('offer-out', 'pact', 'p2');
    expect(d.noteKey).toBe('log.diplo.sent');
    expect(d.message).toBeNull();
    expect(d.unread).toBe(false);
  });
});

describe('правило 4 — автор реплики в треде это другая сторона', () => {
  it.each(['stance', 'offer-in'] as const)('%s: автор — собеседник, а не я', (kind) => {
    expect(diploDelivery(kind, 'peace', 'p7').message?.from).toBe('p7');
  });
});

describe('правило 5 — реплика в тред называет только стойку', () => {
  it('у сдвига своя короткая форма', () => {
    expect(diploDelivery('stance', 'peace', 'p2').message?.key).toBe('comms.stance-changed.short');
  });
  it('у предложения своя короткая форма', () => {
    expect(diploDelivery('offer-in', 'peace', 'p2').message?.key).toBe('log.diplo.offer.short');
  });
  it('короткий ключ никогда не совпадает с ключом ленты', () => {
    for (const kind of ['stance', 'offer-in'] as const) {
      const d = diploDelivery(kind, 'peace', 'p2');
      expect(d.message?.key).not.toBe(d.noteKey);
    }
  });
});

describe('полный перебор видов и стоек', () => {
  it('каждая пара «вид × стойка» даёт непротиворечивую доставку', () => {
    let n = 0;
    for (const kind of ['stance', 'offer-in', 'offer-out'] as DiploKind[])
      for (const st of ['war', 'peace', 'pact', 'alliance']) {
        const d = diploDelivery(kind, st, 'p2');
        // непрочитанное бывает только там, где есть реплика в треде
        expect(d.unread).toBe(d.message !== null);
        // ключ ленты у исходящего всегда один и тот же
        if (kind === 'offer-out') expect(d.noteKey).toBe('log.diplo.sent');
        n++;
      }
    expect(n).toBe(12);
  });
});

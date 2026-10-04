/**
 * СВОЙ БОЙ ВИДЕН (баг владельца 2026-09-29: «мой флот столкнулся с невидимым вражеским
 * флотом. Я сначала даже и не понял, почему замер мой флот»).
 *
 * Правило живёт в ядре (`engagementOf`), прототип читает его через две функции:
 * `fleetKnown` (флот опознан — по узлу, по моему бою или по позиции в круге моей мины или
 * висящего патруля, SHU-6.7) и `battleKnown` (бой виден). Мест,
 * где туман спрашивают о флоте или бое, в `main.ts` больше десятка, и каждое прежде
 * спрашивало узел напрямую. Сторож держит их все: новая проверка «по узлу» мимо этих
 * двух функций снова спрячет врага в моём же бою.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const count = (needle: string): number => main.split(needle).length - 1;

describe('туман спрашивает о флоте и бое только через fleetKnown / battleKnown', () => {
  it('узел флота напрямую спрашивает только fleetKnown', () => {
    expect(count('known(fleetNode(')).toBe(1);
    expect(main).toContain(
      'return known(fleetNode(f)) || !!vision?.engaged.fleets.has(f.id) || !!vision?.seenAt.has(f.id);',
    );
  });

  it('узел боя напрямую спрашивает только battleKnown', () => {
    expect(count('known(b.location)')).toBe(1);
    expect(main).toContain('return known(b.location) || !!vision?.engaged.battles.has(b.id);');
  });

  it('зрение кадра несёт мои бои из ядра', () => {
    expect(main).toContain('engaged: engagementOf(s, ME),');
  });

  it('зрение кадра несёт флоты, опознанные по позиции, из ядра (SHU-6.7)', () => {
    expect(main).toContain('const seenAt = fleetsSeenByPosition(s, ME, data);');
  });
});

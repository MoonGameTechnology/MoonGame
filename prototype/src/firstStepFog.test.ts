/**
 * ПЕРВЫЙ ШАГ ПАРТИИ ЖУРНАЛ СУДИТ ПО ЕЁ ЖЕ ЗРЕНИЮ (FOG-13, найдено при FOG-12).
 *
 * Партию засевает шаг мира (`apply(advance(s, s.time + 1))`) сразу после `installMatch`,
 * до первого кадра, а `vision` пересчитывал только кадр, и то ПОСЛЕ своего шага мира.
 * События засевающего шага журнал проверял по зрению прошлой партии, а после загрузки
 * страницы — по `null`, который `known()` читает как «туман выключен, видно всё». Сетевой
 * клиент держал зрение прошлого снимка до следующего кадра, а события дельты идут в журнал
 * сразу после снимка — и по смене карты, и по миру, открывшемуся обычной дельтой.
 *
 * `main.ts` — DOM-вход без юнит-харнеса, поэтому сторож держит проводку: правило «туман
 * выключен» живёт в одной `fogVision()`, и `vision` переписывается ею везде, где появляется
 * новый мир.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
// Зрение кадра и его двери живут у тумана (`mapFog.ts`, REFM-231): `main.ts` зовёт дверь
// `refreshVision()`, а присваивает `vision` только она.
const fog = readFileSync(new URL('./mapFog.ts', import.meta.url), 'utf8');
const count = (needle: string, src = main): number => src.split(needle).length - 1;
/** Тело функции верхнего уровня — до следующей функции верхнего уровня. */
const functionBody = (start: string, src = main): string => {
  const at = src.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\nfunction ', at + start.length));
};

describe('зрение журнала на первом шаге партии (FOG-13)', () => {
  it('«туман выключен» решает одна fogVision — и только тумблер песочницы', () => {
    expect(count('sandboxConfig.enabled && !sandboxConfig.fog')).toBe(0);
    expect(count('sandboxConfig.enabled && !sandboxConfig.fog', fog)).toBe(1);
    expect(functionBody('function fogVision(', fog)).toMatch(
      /sandboxConfig\.enabled && !sandboxConfig\.fog\s*\?\s*null\s*:\s*currentVision\(\);/,
    );
  });

  it('смена партии переписывает зрение до засевающего шага мира', () => {
    const install = functionBody('function installMatch(');
    const fresh = install.indexOf('refreshVision();');
    expect(fresh).toBeGreaterThan(install.indexOf('resetFogMemory();'));
    expect(install.indexOf('resetFogMemory();')).toBeGreaterThan(-1);
    // Новое зрение считается по НОВОМУ миру и игроку — оба присвоены раньше.
    expect(install.indexOf('s = state;')).toBeLessThan(fresh);
    expect(install.indexOf("ME = 'p1';")).toBeLessThan(fresh);
    // ...и уже без песочницы прошлой партии: её выключенный туман не должен стать «видно
    // всё» засевающего шага (замечание Codex на #1490).
    expect(install.indexOf('sandboxConfig.enabled = false;')).toBeLessThan(fresh);
  });

  it('каждый сетевой снимок переписывает зрение раньше событий своей дельты', () => {
    // Не только смена карты: обычная дельта тоже открывает миры, а сервер пропустил её
    // события по опознанным узлам этого снимка (замечание Codex на #1490).
    const fresh = main.indexOf("refreshVision(); // every snapshot: its delta's events follow");
    expect(fresh).toBeGreaterThan(main.indexOf('if (snap.playerId) ME = snap.playerId;'));
    expect(fresh).toBeGreaterThan(
      main.indexOf('netSignatures = [...radarContacts(snap.signatures)];'),
    );
    expect(main).not.toContain('if (changedMap) refreshVision();');
  });

  it('кадр берёт зрение той же функцией, а других присваиваний нет', () => {
    expect(main).toContain('refreshVision(); // fog projection for this frame');
    expect(count('refreshVision()')).toBe(3);
    // Присваивает зрение одна дверь, и пересчитывает она его той же `fogVision`.
    expect(fog.match(/^\s*vision = /gm)).toHaveLength(1);
    expect(functionBody('export function refreshVision(', fog)).toContain('vision = fogVision();');
  });
});

/**
 * СВОЙ БОЙ ВИДЕН (баг владельца 2026-09-29: «мой флот столкнулся с невидимым вражеским
 * флотом. Я сначала даже и не понял, почему замер мой флот»).
 *
 * Правило живёт в ядре (`engagementOf`), прототип читает его через две функции:
 * `fleetKnown` (флот опознан — по узлу, по моему бою или по позиции в круге моей мины или
 * висящего патруля, SHU-6.7) и `battleKnown` (бой виден). Мест,
 * где туман спрашивают о флоте или бое, в `main.ts` и ленте (`eventFeed.ts`) больше
 * десятка, и каждое прежде спрашивало узел напрямую. Сторож держит их все: новая проверка «по узлу» мимо этих
 * двух функций снова спрячет врага в моём же бою.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
// Сами вопросы к туману живут у его владельца (`mapFog.ts`, REFM-231); `main.ts` их задаёт.
const fog = readFileSync(new URL('./mapFog.ts', import.meta.url), 'utf8');
// Разбор событий живёт у ленты (`eventFeed.ts`, REFM-230); `main.ts` её сбрасывает.
const feed = readFileSync(new URL('./eventFeed.ts', import.meta.url), 'utf8');
const count = (needle: string, src = main): number => src.split(needle).length - 1;

describe('туман спрашивает о флоте и бое только через fleetKnown / battleKnown', () => {
  it('узел флота напрямую спрашивает только fleetKnown', () => {
    expect(count('known(fleetNode(')).toBe(0);
    expect(count('known(fleetNode(', feed)).toBe(0);
    expect(count('known(fleetNode(', fog)).toBe(1);
    expect(fog).toContain(
      'return known(fleetNode(f)) || !!vision?.engaged.fleets.has(f.id) || !!vision?.seenAt.has(f.id);',
    );
  });

  it('узел боя напрямую спрашивает только battleKnown', () => {
    expect(count('known(b.location)')).toBe(0);
    expect(count('known(b.location)', feed)).toBe(0);
    expect(count('known(b.location)', fog)).toBe(1);
    expect(fog).toContain('return known(b.location) || !!vision?.engaged.battles.has(b.id);');
  });

  it('зрение кадра несёт мои бои из ядра', () => {
    expect(fog).toContain('engaged: engagementOf(s, ME),');
  });

  it('зрение кадра несёт флоты, опознанные по позиции, из ядра (SHU-6.7)', () => {
    expect(fog).toContain('const seenAt = fleetsSeenByPosition(s, ME, data);');
  });

  it('мгновенный бой журнал адресует по сторонам из событий — тем же правилом, что сервер', () => {
    // Бой союзника, начатый и законченный одним пакетом, в `s` уже не найти (замечание
    // Codex на #1417); аудиторию ему считает `flashBattles` ядра, как и на сервере.
    expect(feed).toContain('const flash = flashBattles(events, s);');
    // Начало, запоминание боя и ведомость потерь — одна видимость (замечание Codex на #1418).
    expect(count('flashSeen(p.battleId)', feed)).toBe(3);
    expect(feed).toContain('const lossSeen = battleEngaged(p.battleId) || flashSeen(p.battleId);');
  });

  it('память боёв блока зрения не переживает смену матча', () => {
    // id боёв (`battle:0`…) повторяются от матча к матчу (замечание Codex на #1417).
    expect(feed).toMatch(/myBattleLocs\.clear\(\);\n\s*engagedBattleIds\.clear\(\);/);
    const install = main.slice(main.indexOf('function installMatch('));
    expect(install.slice(0, install.indexOf('\n}\n'))).toContain('resetEventFeed();');
  });
});

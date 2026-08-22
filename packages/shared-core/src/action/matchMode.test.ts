import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadGameData } from '../data/loadGameData';
import type { GameData } from '../data/schemas';
import { resolveMatchConfig } from './matchMode';
import type { MatchConfig } from './types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const data: GameData = loadGameData((name) =>
  JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')),
);

/** The shipped bundle plus one synthetic mode — the shipped `standard` restates the base
 *  rules verbatim, so it cannot show that a preset actually REACHES the config. A mode
 *  with distinctive numbers can. */
const withMode = (id: string, victory: Record<string, number>): GameData => ({
  ...data,
  modes: { ...data.modes, [id]: { name: id, victory, teamFormat: 'ffa', modules: [] } },
});

describe('resolveMatchConfig (PVE-0.2) — режим матча превращается в правила', () => {
  it('без modeId возвращает конфиг как есть (обратная совместимость)', () => {
    // Каждый существующий матч создан БЕЗ режима. Резолв не имеет права ничего им
    // подмешать — иначе кирпич меняет правила уже идущих сессий.
    const config: MatchConfig = { timeScale: 4, victory: { scoreLimit: 900 } };
    const res = resolveMatchConfig(data, config);
    expect(res).toEqual({ ok: true, config });
  });

  it('подмешивает victory пресета и сохраняет modeId (консервация)', () => {
    const res = resolveMatchConfig(withMode('brisk', { scoreLimit: 120 }), {
      timeScale: 1,
      modeId: 'brisk',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.victory?.scoreLimit).toBe(120);
    // modeId остаётся В конфиге: конфиг персистится вместе с матчем, и именно так
    // режим переживает рестарт — иначе восстановленный матч потеряет свои правила.
    expect(res.config.modeId).toBe('brisk');
    expect(res.config.timeScale).toBe(1);
  });

  it('явное правило матча бьёт пресет поле-в-поле, остальное берётся из пресета', () => {
    const res = resolveMatchConfig(
      withMode('brisk', { scoreLimit: 120, dominationPercent: 0.4 }),
      { timeScale: 1, modeId: 'brisk', victory: { scoreLimit: 999 } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.victory?.scoreLimit).toBe(999); // матч переопределил
    expect(res.config.victory?.dominationPercent).toBe(0.4); // пресет уцелел
  });

  it('неизвестный modeId — ОТКАЗ, а не тихий откат на базовые правила (fail-secure)', () => {
    // Молчаливый откат — это матч, который считает себя PvE-волнами и играет по
    // обычным правилам. Тот же класс отказа, что MP-4: правила подменились под
    // матчем, и загрузка обязана отказать, а не догадываться.
    expect(resolveMatchConfig(data, { timeScale: 1, modeId: 'no_such_mode' })).toEqual({
      ok: false,
      code: 'E_UNKNOWN_MODE',
    });
    // Пустая строка — тоже не режим (fail-closed на пограничном значении).
    expect(resolveMatchConfig(data, { timeScale: 1, modeId: '' })).toEqual({
      ok: false,
      code: 'E_UNKNOWN_MODE',
    });
  });

  it('не мутирует вход (инвариант чистоты)', () => {
    const config: MatchConfig = { timeScale: 1, modeId: 'brisk', victory: { scoreLimit: 999 } };
    const before = JSON.stringify(config);
    resolveMatchConfig(withMode('brisk', { scoreLimit: 120, dominationPercent: 0.4 }), config);
    expect(JSON.stringify(config)).toBe(before);
  });

  it('шипнутый `standard` резолвится и даёт сегодняшние базовые правила', () => {
    const res = resolveMatchConfig(data, { timeScale: 1, modeId: 'standard' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.victory).toEqual({
      dominationPercent: 0.6,
      scoreLimit: 600,
      coalitionFactor: 0.7,
    });
  });
});

/**
 * YAG-5.1 — словарь `PLATFORM_EVENTS` расставлен по игре. Что именно уходит и когда,
 * проверяет робот `sectorzerotest.mjs` на живой странице; здесь — два правила, которые
 * роботу не видны:
 *
 * 1. **У каждого события словаря есть место эмиссии**, кроме тех, что ждут своей механики.
 *    Покупок за деньги в игре нет (`YAG-4.2` 🔒), поэтому `iap_*` сказать нечего. Список
 *    ожидающих выписан поимённо: появится эмиссия — событие придётся вычеркнуть отсюда.
 * 2. **Замер не влияет на симуляцию** (`metrics-roadmap.md`): в ядре нет ни эмиссии, ни
 *    словаря — ни одного счётчика внутри `applyAction`/`advanceTo`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLATFORM_EVENTS } from './types';

const PENDING = ['iap_started', 'iap_completed'];

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), 'utf8');
/** Места эмиссии: проводка клиента и чистые решения, которые называют событие. */
const sites = [read('../main.ts'), read('../../../decisions/runAnalytics.ts')].join('\n');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('YAG-5.1 — словарь аналитики расставлен по игре', () => {
  it.each(PLATFORM_EVENTS.filter((e) => !PENDING.includes(e)))('%s эмитится', (event) => {
    expect(sites).toContain(`'${event}'`);
  });

  it.each(PENDING)('%s ждёт своей механики и пока не эмитится', (event) => {
    expect(PLATFORM_EVENTS).toContain(event);
    expect(sites).not.toContain(`'${event}'`);
  });

  it('в ядре нет аналитики: замер не влияет на симуляцию', () => {
    const core = sources(path.join(here, '../../../packages/shared-core/src'));
    expect(core.length).toBeGreaterThan(50);
    for (const file of core)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/analytics|PLATFORM_EVENTS/);
  });
});

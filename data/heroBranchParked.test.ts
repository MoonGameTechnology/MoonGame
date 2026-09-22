/**
 * ВЕТКИ ГЕРОЕВ ПРИПАРКОВАНЫ, А НЕ УДАЛЕНЫ (HERO-11, заказ владельца 2026-09-22).
 *
 * Разделение на трансгуманизм и псионику убрано ИЗ ИГРЫ, но не из репозитория: каждый
 * архетип и каждый узел дерева, у которого ветка была, хранит её под ключом
 * `parkedBranch`, которого схема НЕ знает — zod такой ключ молча отбрасывает, и игра
 * видит одно общее дерево. Механизм в ядре цел: `hero.skill.unlock` по-прежнему отвечает
 * `E_WRONG_BRANCH` на чужой узел, и это проверено на фикстурном каталоге в
 * `packages/shared-core/src/modules/hero.test.ts` — парковка каталога до тех тестов не
 * дотягивается, потому они и остались зелёными без единой правки.
 *
 * Парковка держится на ДВУХ утверждениях, и оба нужны:
 *  1. в шипнутом каталоге не осталось ЖИВОЙ ветки — иначе разделение тихо вернулось бы
 *     половиной (часть узлов общая, часть нет — худший из миров);
 *  2. припаркованные значения все на месте и совпадают с тем, что было до парковки —
 *     иначе «пока убрать» незаметно превратилось бы в «удалить», и расставить 15 веток
 *     обратно было бы уже неоткуда. Распарковка — переименование ключа, и список ниже
 *     ровно то, во что переименовывать.
 *
 * Побочное следствие, зафиксированное осознанно: фильтр чужой ветки в `prototype/src/ai.ts`
 * и ветка `E_WRONG_BRANCH` в ядре сейчас КАТАЛОГОМ НЕДОСТИЖИМЫ. Это не мусор под уборку
 * (ср. CONV-16, где недостижимость была дефектом) — это цена обратимости, и тест здесь
 * затем, чтобы следующий читатель увидел решение, а не догадку.
 */
import { describe, expect, it } from 'vitest';
import heroes from './heroes.json';
import heroSkillTrees from './heroSkillTrees.json';
import { shippedGameData } from './bundle';

/** Что было до парковки — дословно. Распарковка обязана вернуть ровно это. */
const PARKED_ARCHETYPES: Record<string, string> = {
  commander: 'transhuman',
  ravager: 'psionic',
  vanguard: 'transhuman',
  warden: 'psionic',
};
const PARKED_NODES: Record<string, string> = {
  neural_lace: 'transhuman',
  overclocked_helm: 'transhuman',
  corridor_sustained: 'transhuman',
  corridor_open: 'transhuman',
  fleet_uplink: 'transhuman',
  void_translocator: 'transhuman',
  void_attunement: 'psionic',
  psi_veil: 'psionic',
  psi_weak_points: 'psionic',
  psi_evasion: 'psionic',
  false_echo: 'psionic',
};

const parked = (v: unknown): string | undefined =>
  typeof (v as { parkedBranch?: unknown }).parkedBranch === 'string'
    ? (v as { parkedBranch: string }).parkedBranch
    : undefined;

describe('HERO-11 — разделение на ветки убрано из игры', () => {
  it('ни один шипнутый архетип и ни один узел дерева не несёт живой ветки', () => {
    const data = shippedGameData();
    expect(Object.entries(data.heroes).filter(([, d]) => d.branch !== undefined)).toEqual([]);
    expect(
      Object.entries(data.heroSkillTrees).filter(([, n]) => n.branch !== undefined),
    ).toEqual([]);
  });

  it('все 19 узлов дерева открыты любому герою — общее дерево, а не две половины', () => {
    const data = shippedGameData();
    const nodes = Object.keys(data.heroSkillTrees);
    expect(nodes.length).toBeGreaterThan(0);
    // Узел без ветки ядро пускает кому угодно, включая безархетипного героя.
    expect(nodes.every((id) => data.heroSkillTrees[id]!.branch === undefined)).toBe(true);
  });

  it('припаркованные значения не потеряны — распарковка возвращает ровно то, что было', () => {
    const gotArch = Object.fromEntries(
      Object.entries(heroes as Record<string, unknown>)
        .map(([id, d]) => [id, parked(d)])
        .filter(([, b]) => b !== undefined),
    );
    expect(gotArch).toEqual(PARKED_ARCHETYPES);
    const gotNodes = Object.fromEntries(
      Object.entries(heroSkillTrees as Record<string, unknown>)
        .map(([id, n]) => [id, parked(n)])
        .filter(([, b]) => b !== undefined),
    );
    expect(gotNodes).toEqual(PARKED_NODES);
  });

  it('`parkedBranch` не просочился в загруженный каталог — схема его не знает', () => {
    const data = shippedGameData();
    for (const def of Object.values(data.heroes)) {
      expect(Object.hasOwn(def, 'parkedBranch')).toBe(false);
    }
    for (const node of Object.values(data.heroSkillTrees)) {
      expect(Object.hasOwn(node, 'parkedBranch')).toBe(false);
    }
  });
});

// BAL-12 — что из дерева технологий прибор замера ВИДИТ.
//
// Отчёт self-play считал «не исследованы ни разу» по всему `data.technologies`, включая
// псевдоузлы мета-прокачки: они не исследуются, а выдаются как `completed` на старте
// матча. Знаменатель от этого раздувался, и доля мёртвого дерева читалась меньше, чем
// есть. Правило «мета-гранты — не узлы сессии» в репозитории уже было, но ровно в одном
// месте — окне дерева технологий (`techTree.ts`); харнес про него не знал.
//
// Второй слой — `has_scientist`. Ноль в отчёте у такого узла может значить три РАЗНЫХ
// вещи: «некому расгейтить» (нет учёного ветки — дыра каталога, BAL-13), «замер до него
// не доживает» (`dayGate` за концом окна) и «достижим, но бот не взял» (вот это и есть
// баланс). Пока они сливались в один ноль, нерф по отчёту бил не туда.
import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { META_TREE } from './meta';
import { isGrantOnlyTech, researchableTechIds, scientistGatedNodes } from './techCoverage';

const LEADERS = { overseer: { branch: 'command' }, polymath: {} };

describe('BAL-12 — грант-узлы не входят в дерево сессии', () => {
  it('грант-узел отделяется от настоящего — по ФЛАГУ данных, не по имени', () => {
    expect(isGrantOnlyTech('boon_gunnery', { grantOnly: true })).toBe(true);
    expect(isGrantOnlyTech('industrial_automation', { grantOnly: false })).toBe(false);
    // Префикс остаётся запасным ответом там, где определения под рукой нет.
    expect(isGrantOnlyTech('meta_industry')).toBe(true);
    expect(isGrantOnlyTech('industrial_automation')).toBe(false);
  });

  it('знаменатель «не исследовано» считается по настоящему дереву', () => {
    expect(researchableTechIds({ meta_industry: {}, signal_corps: {} })).toEqual(['signal_corps']);
    // …и усиление забега тоже не узел сессии, хотя имя у него другое.
    expect(researchableTechIds({ boon_gunnery: { grantOnly: true }, signal_corps: {} })).toEqual([
      'signal_corps',
    ]);
  });

  it('на ЖИВЫХ данных каждый грант-узел и правда кем-то выдаётся', () => {
    // Сторож против узла-сироты: `grantOnly` выводит узел из дерева сессии, и если за
    // ним НИКТО не стоит, он молча выпадает из замера, а взять его нельзя вовсе —
    // отчёт соврёт, а контент окажется мёртвым. Выдающих двое: мета-дерево командира
    // (`META_TREE`) и пул усилений забега (`data.modes[*].pve.boons`, PVR-1.4).
    const granted = new Set([
      ...META_TREE.flatMap((n) => n.tech ?? []),
      ...Object.values(data.modes).flatMap((mode) => mode.pve?.boons ?? []),
    ]);
    const grantOnly = Object.entries(data.technologies)
      .filter(([id, def]) => isGrantOnlyTech(id, def))
      .map(([id]) => id);
    expect(grantOnly.length).toBeGreaterThan(0);
    for (const id of grantOnly) expect(granted).toContain(id);
  });
});

describe('BAL-12 — слой has_scientist в отчёте', () => {
  const gated = {
    open_node: { dayGate: 0, conditions: [] },
    in_window: {
      dayGate: 5,
      conditions: [{ type: 'has_scientist' as const, branch: 'command' as const, minLevel: 1 }],
    },
    late_node: {
      dayGate: 15,
      conditions: [{ type: 'has_scientist' as const, branch: 'command' as const, minLevel: 1 }],
    },
    orphan_node: {
      dayGate: 3,
      conditions: [{ type: 'has_scientist' as const, branch: 'ground' as const, minLevel: 1 }],
    },
  };
  const rows = scientistGatedNodes(gated, LEADERS, new Map([['in_window', 12]]), 14);
  const row = (id: string) => rows.find((r) => r.id === id);

  it('узел без условия на учёного в слой не попадает', () => {
    expect(rows.map((r) => r.id)).toEqual(['in_window', 'late_node', 'orphan_node']);
  });

  it('достижимый узел несёт своё число исследований', () => {
    expect(row('in_window')).toMatchObject({ hasLeader: true, outsideWindow: false, researched: 12 });
  });

  it('`dayGate` за концом окна помечается отдельно — ноль тут НЕ про баланс', () => {
    // Узел, до которого замер не доживает, невидим by construction. Нерфить его по нулю
    // в отчёте было бы ошибкой прибора, а не находкой по контенту.
    expect(row('late_node')).toMatchObject({ outsideWindow: true, researched: 0 });
    expect(row('in_window')!.outsideWindow).toBe(false);
  });

  it('ветка без лидера в каталоге помечается отдельно — это дыра ростера', () => {
    expect(row('orphan_node')).toMatchObject({ hasLeader: false, outsideWindow: false });
  });

  it('окно длиннее гейта открывает узел — так замеряется линия «Хранителя»', () => {
    const longer = scientistGatedNodes(gated, LEADERS, new Map(), 20);
    expect(longer.find((r) => r.id === 'late_node')!.outsideWindow).toBe(false);
  });

  it('на ЖИВЫХ данных слой читается так, как его описал кирпич', () => {
    // Сторож: сегодня `has_scientist` стоит ровно на линии «Хранителя», и она за окном
    // стандартного прогона (14 дней против `dayGate: 15`). Появится второй такой узел
    // или сдвинется гейт — тест заставит переписать разбор, а не унаследовать его.
    const live = scientistGatedNodes(data.technologies, data.scientists, new Map(), 14);
    expect(live.map((r) => r.id)).toEqual(['ai_stewardship']);
    expect(live[0]).toMatchObject({ branch: 'command', hasLeader: true, outsideWindow: true });
  });
});

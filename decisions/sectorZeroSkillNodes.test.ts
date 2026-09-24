import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import type { Hero } from '../packages/shared-core/src/index';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  newSectorHero,
  parseSectorZeroProgress,
  prepareSectorZeroRun,
  sectorSkillCard,
  sectorSkillLegal,
  type SectorZeroProgress,
} from './sectorZeroProgress';
import { offerOwned } from './sectorZeroShop';

// AUD-22 (решение владельца 2026-09-24): узел, чья награда у героя уже есть со старта,
// считается изученным. Ни Академия, ни магазин его не продают, а узлы за ним открыты.
// Правило одно с ядром (`knownSkillNodes`) — здесь проверяется, что подготовка Sector Zero
// читает его, а не свою копию.

const data = shippedGameData();

/** Профиль, где открыт и выбран герой `archetype`, а Исследований хватит на всё дерево. */
function withHero(archetype: string): SectorZeroProgress {
  const p = freshSectorZeroProgress(data);
  return {
    ...p,
    research: 1_000_000,
    heroes: { ...p.heroes, [archetype]: newSectorHero(archetype, data) },
    selectedHero: archetype,
  };
}
const skill = (hero: string, id: string) => ({ kind: 'skill' as const, hero, id });

describe('AUD-22 — узел с врождённой наградой в подготовке Sector Zero', () => {
  it('Командир: «Сонастройка» и «Пси-вуаль» уже изучены — не покупаются и не списывают', () => {
    const p = withHero('commander');
    for (const id of ['void_attunement', 'psi_veil']) {
      expect(changeSectorZeroProgress(p, skill('commander', id), data), id).toBeNull();
      expect(sectorSkillLegal(p, id, data), id).toBe(false);
      // В магазине это «уже открыто», а не «закрыто»: награда у героя есть.
      expect(offerOwned({ kind: 'skill', grants: id }, p, data), id).toBe(true);
    }
    // Настоящий узел рядом по-прежнему продаётся.
    expect(offerOwned({ kind: 'skill', grants: 'wreck_rig' }, p, data)).toBe(false);
    expect(sectorSkillLegal(p, 'wreck_rig', data)).toBe(true);
  });

  it('узлы за врождённым открыты сразу — родитель засчитан изученным', () => {
    const p = withHero('commander');
    // `psi_weak_points` и `false_echo` требуют `psi_veil`, которого нет в `skills`.
    for (const id of ['psi_weak_points', 'false_echo']) {
      expect(sectorSkillLegal(p, id, data), id).toBe(true);
      expect(changeSectorZeroProgress(p, skill('commander', id), data), id).not.toBeNull();
    }
    // Врождённость — свойство архетипа: у Стража «Пси-вуали» нет, и её дети закрыты.
    const warden = withHero('warden');
    expect(sectorSkillLegal(warden, 'psi_weak_points', data)).toBe(false);
    expect(sectorSkillLegal(warden, 'psi_veil', data)).toBe(false); // нужен void_attunement
    expect(sectorSkillLegal(warden, 'void_attunement', data)).toBe(true);
  });

  it('карточка Академии: врождённый узел «открыт», его дети без замка', () => {
    const commander = withHero('commander').heroes.commander!;
    expect(sectorSkillCard('commander', commander, 'void_attunement', data)).toEqual({
      owned: true,
      missing: [],
    });
    expect(sectorSkillCard('commander', commander, 'psi_weak_points', data)).toEqual({
      owned: false,
      missing: [],
    });
    // У Стража та же карточка честно называет, чего не хватает.
    const warden = withHero('warden').heroes.warden!;
    expect(sectorSkillCard('warden', warden, 'psi_weak_points', data)).toEqual({
      owned: false,
      missing: ['psi_veil'],
    });
  });

  it('профиль с узлом за врождённым переживает перечитывание', () => {
    const p = changeSectorZeroProgress(
      withHero('commander'),
      skill('commander', 'psi_weak_points'),
      data,
    )!;
    const back = parseSectorZeroProgress(JSON.stringify(p), data);
    expect(back.heroes.commander?.skills).toEqual(['psi_weak_points']);
  });

  it('старый профиль с пустой покупкой читается без неё, а ветка за ней остаётся', () => {
    // До AUD-22 Командир мог купить врождённые узлы. Запись о них ничего не давала и
    // теперь отбрасывается при чтении; купленное ниже по ветке не теряется.
    const legacy = {
      ...withHero('commander'),
      heroes: {
        commander: {
          level: 1,
          skills: ['void_attunement', 'psi_veil', 'psi_weak_points'],
          equipped: ['rally'],
        },
      },
    };
    const back = parseSectorZeroProgress(JSON.stringify(legacy), data);
    expect(back.heroes.commander?.skills).toEqual(['psi_weak_points']);
  });
});

describe('AUD-22 — шипнутый каталог: покупка в Академии всегда что-то привозит в забег', () => {
  const base = pveState(data);
  /** Узлы дерева в порядке «родитель раньше ребёнка». */
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const parent of data.heroSkillTrees[id]?.requires ?? []) visit(parent);
    order.push(id);
  };
  Object.keys(data.heroSkillTrees).sort().forEach(visit);

  const runHero = (p: SectorZeroProgress): Hero =>
    Object.values(prepareSectorZeroRun(base, p, data).heroes ?? {}).find((h) => h.owner === 'p1')!;
  const loadout = (h: Hero): number => (h.abilities?.length ?? 0) + (h.passives?.length ?? 0);

  for (const archetype of Object.keys(data.heroes).sort()) {
    it(`${archetype}: каждая оплаченная покупка расширяет героя забега`, () => {
      let p = withHero(archetype);
      let bought = 0;
      for (const id of order) {
        if (!sectorSkillLegal(p, id, data)) continue;
        const before = runHero(p);
        const next = changeSectorZeroProgress(p, skill(archetype, id), data);
        if (!next) throw new Error(`${archetype}/${id}: законный узел не купился`);
        expect(next.research, id).toBeLessThan(p.research);
        p = next;
        bought++;
        const after = runHero(p);
        expect(after.skills, id).toContain(id);
        const { ability, passive, passives = [] } = data.heroSkillTrees[id]!.grants;
        // Узел с наградой обязан её привезти; ступень без наград улучшает способность
        // через `skills` (ядро читает лестницу из данных) и набор не расширяет.
        if (ability !== undefined || passive !== undefined || passives.length > 0)
          expect(loadout(after), id).toBeGreaterThan(loadout(before));
      }
      expect(bought).toBeGreaterThan(0);
    });
  }
});

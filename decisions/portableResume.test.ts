import { describe, expect, it } from 'vitest';
import {
  describeRun,
  parsePortableRun,
  resumePortableRun,
  type ResumableState,
  type PortableRunSave,
} from './portableRun';
import { portableRunPreview } from './sectorZeroMenu';
import { DEFAULT_RUN_DIFFICULTY } from './runDifficulty';

/** Свежий мир забега сразу после посева PvE: волна 0 из 10, следующая назначена. */
const fresh = (): ResumableState => ({
  pve: { waveNumber: 0, totalWaves: 10, nextWaveAt: 21_600_000 },
  players: {
    p1: { technologies: { completed: ['hull_basics'] } },
    swarm: { technologies: { completed: [] } },
  },
});
const save = (over: Partial<PortableRunSave> = {}): PortableRunSave => ({
  v: 1,
  mode: 'pve-1',
  difficulty: 'strong',
  wave: 3,
  ...over,
});
const BOONS = ['boon_a', 'boon_b', 'boon_c'] as const;

describe('YAG-2.1 — забег возвращается по дескриптору на ту же волну', () => {
  it('волна и усиления из дескриптора — в том же порядке, после своих технологий', () => {
    const state = resumePortableRun(fresh(), save({ boons: ['boon_b', 'boon_a'] }), 'p1', BOONS);
    expect(state?.pve?.waveNumber).toBe(3);
    // Порядок — порядок ВЗЯТИЯ: так его и сохранил описатель.
    expect(state?.players?.p1?.technologies?.completed).toEqual([
      'hull_basics',
      'boon_b',
      'boon_a',
    ]);
  });

  it('усиления берутся ТОЛЬКО из списка режима: чужой id в дескрипторе не становится технологией', () => {
    // Дескриптор приезжает из хранилища, которое правит кто угодно: иначе через него можно
    // было бы выдать себе любую технологию каталога.
    const state = resumePortableRun(
      fresh(),
      save({ boons: ['boon_a', 'tech_superweapon'] }),
      'p1',
      BOONS,
    );
    expect(state?.players?.p1?.technologies?.completed).toEqual(['hull_basics', 'boon_a']);
  });

  it('уже взятое не дублируется', () => {
    const world = fresh();
    world.players!.p1!.technologies!.completed = ['boon_a'];
    const state = resumePortableRun(world, save({ boons: ['boon_a', 'boon_c'] }), 'p1', BOONS);
    expect(state?.players?.p1?.technologies?.completed).toEqual(['boon_a', 'boon_c']);
  });

  it('волна сверх длины забега срезается до последней, и отсчёта к следующей больше нет', () => {
    const state = resumePortableRun(fresh(), save({ wave: 99 }), 'p1', BOONS);
    expect(state?.pve?.waveNumber).toBe(10);
    // Иначе HUD показывал бы обратный отсчёт до волны, которой не будет.
    expect(state?.pve?.nextWaveAt).toBeUndefined();
  });

  it('обычная волна отсчёт к следующей сохраняет', () => {
    expect(resumePortableRun(fresh(), save(), 'p1', BOONS)?.pve?.nextWaveAt).toBe(21_600_000);
  });

  it('мир без посева PvE или без игрока — «восстановить нечем», а не полумир', () => {
    const { pve: _drop, ...unseeded } = fresh();
    expect(resumePortableRun(unseeded, save(), 'p1', BOONS)).toBeNull();
    expect(resumePortableRun(fresh(), save(), 'p9', BOONS)).toBeNull();
  });

  it('функция чистая: вход не меняется', () => {
    const world = fresh();
    const before = JSON.stringify(world);
    resumePortableRun(world, save({ boons: ['boon_a'] }), 'p1', BOONS);
    expect(JSON.stringify(world)).toBe(before);
  });
});

describe('YAG-2.1 — карточка «Продолжить» по дескриптору', () => {
  it('режим совпал — волна, длина забега и сложность', () => {
    expect(portableRunPreview(save(), 'pve-1', 10)).toEqual({
      wave: 3,
      total: 10,
      difficulty: 'strong',
    });
  });

  it('другая миссия выбрана — карточки нет: дескриптор принадлежит своей', () => {
    expect(portableRunPreview(save(), 'pve-2', 10)).toBeNull();
  });

  it('режима больше нет в данных или забег уже кончился — карточки нет', () => {
    expect(portableRunPreview(save(), 'pve-1', 0)).toBeNull();
    expect(portableRunPreview(save({ wave: 10 }), 'pve-1', 10)).toBeNull();
    expect(portableRunPreview(null, 'pve-1', 10)).toBeNull();
  });

  it('незнакомая сложность читается безопасным значением, а не пропадает', () => {
    expect(portableRunPreview(save({ difficulty: '???' }), 'pve-1', 10)?.difficulty).toBe(
      DEFAULT_RUN_DIFFICULTY,
    );
  });
});

describe('YAG-2.1 — дескриптор знает свою главу', () => {
  // У глав Sector Zero один режим (`pve_waves`): по режиму главу не отличить, а мир
  // собирается из карты главы. Без её id восстановление собрало бы не тот забег.
  const facts = {
    mapId: 'pve-2',
    pve: { waveNumber: 4 },
    players: { p1: { technologies: { completed: [] } } },
  };

  it('описатель берёт id карты из самого мира', () => {
    const save = describeRun(facts, 'p1', () => false, { mode: 'pve_waves', difficulty: 'weak' });
    expect(save.map).toBe('pve-2');
  });

  it('мир без id карты (старый снимок) — поля нет, а не пустая строка', () => {
    const { mapId: _drop, ...legacy } = facts;
    expect(
      describeRun(legacy, 'p1', () => false, { mode: 'pve_waves', difficulty: 'weak' }),
    ).not.toHaveProperty('map');
  });

  it('разбор сохраняет id карты и отбрасывает мусор вместо него', () => {
    const base = { v: 1, mode: 'pve_waves', difficulty: 'weak', wave: 2 };
    expect(parsePortableRun(JSON.stringify({ ...base, map: 'pve-2' }))?.map).toBe('pve-2');
    for (const junk of ['', 7, null, ['pve-2']]) {
      expect(parsePortableRun(JSON.stringify({ ...base, map: junk }))).not.toHaveProperty('map');
    }
  });
});

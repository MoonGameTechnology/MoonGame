import { describe, expect, it } from 'vitest';

import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import {
  comicDue,
  comicId,
  comicProblems,
  comicTaskDue,
  echoComicMoment,
  markComicSeen,
  type ComicRegistry,
} from './chapterComics';
import { freshSectorZeroProgress, parseSectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();
const fresh = () => freshSectorZeroProgress(data, 'comics');
const PANELS = [{ image: 'a.webp', captions: ['k.1'] }, { image: 'b.webp' }];
const REGISTRY: ComicRegistry = { 'pve-1': { intro: PANELS } };

describe('комикс главы — когда показывать (решение владельца 2026-09-24)', () => {
  it('есть комикс и он не показан — отдаём его панели', () => {
    expect(comicDue(fresh(), REGISTRY, 'pve-1', 'intro')).toEqual(PANELS);
  });

  it('показан — больше не показываем: один раз на профиль', () => {
    const seen = markComicSeen(fresh(), comicId('pve-1', 'intro'));
    expect(comicDue(seen, REGISTRY, 'pve-1', 'intro')).toBeNull();
  });

  it('нет арта — нет и комикса: у главы без комикса и у пустого списка панелей', () => {
    expect(comicDue(fresh(), REGISTRY, 'pve-1', 'outro')).toBeNull();
    expect(comicDue(fresh(), REGISTRY, 'pve-2', 'intro')).toBeNull();
    expect(comicDue(fresh(), { 'pve-1': { intro: [] } }, 'pve-1', 'intro')).toBeNull();
  });

  it('отметка чистая и не дублируется', () => {
    const p = fresh();
    const once = markComicSeen(p, 'pve-1:intro');
    expect(p.comicsSeen).toEqual([]);
    expect(once.comicsSeen).toEqual(['pve-1:intro']);
    expect(markComicSeen(once, 'pve-1:intro')).toBe(once);
  });
});

describe('комикс после ключевой задачи главы', () => {
  const REG: ComicRegistry = { 'pve-1': { task: PANELS } };
  const TRIG = { 'pve-1': 'mission.rescue-scientist' };

  it('задача выполнена, комикс не показан — отдаём панели', () => {
    expect(comicTaskDue(fresh(), REG, TRIG, 'pve-1', ['mission.rescue-scientist'])).toEqual(PANELS);
  });

  it('задача не выполнена, у главы нет триггера или комикс уже показан — ничего', () => {
    expect(comicTaskDue(fresh(), REG, TRIG, 'pve-1', ['mission.recon'])).toBeNull();
    expect(comicTaskDue(fresh(), REG, TRIG, 'pve-2', ['mission.rescue-scientist'])).toBeNull();
    const seen = markComicSeen(fresh(), comicId('pve-1', 'task'));
    expect(comicTaskDue(seen, REG, TRIG, 'pve-1', ['mission.rescue-scientist'])).toBeNull();
  });
});

describe('отметка «показан» живёт в профиле — и переживает облако', () => {
  it('новый профиль — ничего не показано', () => {
    expect(fresh().comicsSeen).toEqual([]);
  });

  it('сохранённая отметка читается обратно, мусор — нет', () => {
    const raw = JSON.stringify({
      ...fresh(),
      comicsSeen: [
        'pve-1:intro',
        'pve-2:outro',
        'pve-1:task',
        'pve-1:intro',
        42,
        'не-то',
        'pve-1:credits',
      ],
    });
    expect(parseSectorZeroProgress(raw, data).comicsSeen).toEqual([
      'pve-1:intro',
      'pve-2:outro',
      'pve-1:task',
    ]);
  });

  it('старый профиль без поля читается как «ничего не показано»', () => {
    const { comicsSeen: _dropped, ...old } = fresh();
    expect(parseSectorZeroProgress(JSON.stringify(old), data).comicsSeen).toEqual([]);
  });
});

describe('знакомство с Эхо — порядок и архивная версия', () => {
  const world = () => structuredClone(pveState(data, 0));

  it('разведка или приказ лететь не заменяют прибытие живого своего корабля', () => {
    const state = world();
    expect(echoComicMoment(state, 'p1', true, false)).toBeNull();
    const fleet = Object.values(state.fleets).find((f) => f.owner === 'p1')!;
    fleet.location = 'home_b';
    expect(echoComicMoment(state, 'p1', false, false)).toBeNull();
    expect(echoComicMoment(state, 'p1', true, false)).toBe('echo');
    for (const stack of fleet.units) stack.count = 0;
    expect(echoComicMoment(state, 'p1', true, false)).toBeNull();
  });

  it('раннее освобождение и старое выполнение показывают запись без повторного штурма', () => {
    const state = world();
    state.planets.home_b!.owner = 'p1';
    expect(echoComicMoment(state, 'p1', false, true)).toBeNull();
    expect(echoComicMoment(state, 'p1', true, false)).toBe('echo-record');
    state.planets.home_b!.owner = null;
    expect(echoComicMoment(state, 'p1', true, true)).toBe('echo-record');
  });

  it('обе версии делят отметку и не повторяются после загрузки профиля', () => {
    const registry: ComicRegistry = { 'pve-1': { echo: PANELS, 'echo-record': PANELS } };
    const seen = markComicSeen(fresh(), comicId('pve-1', 'echo-record'));
    const restored = parseSectorZeroProgress(JSON.stringify(seen), data);
    expect(restored.comicsSeen).toContain('pve-1:echo');
    expect(comicDue(restored, registry, 'pve-1', 'echo')).toBeNull();
    expect(comicDue(restored, registry, 'pve-1', 'echo-record')).toBeNull();
  });
});

describe('реестр арта проверяется до того, как доедет до игрока', () => {
  const chapters = ['pve-1', 'pve-2'];
  const hasKey = (k: string) => k.startsWith('k.');

  it('исправный реестр — без замечаний', () => {
    expect(comicProblems(REGISTRY, chapters, hasKey)).toEqual([]);
  });

  it('ловит чужую главу, пустой комикс, пустую картинку и подпись без перевода', () => {
    const bad = {
      'pve-9': { intro: PANELS },
      'pve-2': { intro: [], outro: [{ image: '', captions: ['k.2', 'нет.ключа'] }] },
    } as ComicRegistry;
    expect(comicProblems(bad, chapters, hasKey)).toEqual([
      'pve-9: такой главы нет',
      'pve-2:intro: нет ни одной панели',
      'pve-2:outro #1: нет картинки',
      'pve-2:outro #1: подписи «нет.ключа» нет в локалях',
    ]);
  });

  it('ловит неизвестный момент — комикс, который никто никогда не покажет', () => {
    const odd = { 'pve-1': { credits: PANELS } } as unknown as ComicRegistry;
    expect(comicProblems(odd, chapters, hasKey)).toEqual(['pve-1:credits: такого момента нет']);
  });
});

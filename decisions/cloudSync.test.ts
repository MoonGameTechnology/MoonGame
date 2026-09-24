import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  parseCloudProfile,
  parseSyncMark,
  planCloudSync,
  profileHasProgress,
  serializeCloudProfile,
  type CloudProfile,
  type LocalSync,
} from './cloudSync';
import { freshSectorZeroProgress } from './sectorZeroProgress';

const local = (over: Partial<LocalSync> = {}): LocalSync => ({
  seed: 's1',
  rev: 5,
  syncedRev: 5,
  hasProgress: true,
  ...over,
});
const cloud = (over: Partial<CloudProfile> = {}): CloudProfile => ({
  v: 1,
  seed: 's1',
  rev: 5,
  progress: '{"v":1}',
  ...over,
});

describe('YAG-2.2 — сверка на старте: молча только там, где терять нечего', () => {
  it('облака нет или оно пустое — отправляем свой профиль', () => {
    expect(planCloudSync(local(), null, false)).toBe('upload');
    expect(planCloudSync(local(), cloud({ seed: 'other' }), false)).toBe('upload');
  });

  it('тот же профиль, облако совпадает с последней сверкой — вперёд ушло устройство', () => {
    expect(planCloudSync(local({ rev: 8 }), cloud(), true)).toBe('upload');
    expect(planCloudSync(local(), cloud(), true)).toBe('same');
  });

  it('тот же профиль, вперёд ушло только облако — берём облачный', () => {
    expect(planCloudSync(local(), cloud({ rev: 9 }), true)).toBe('adopt');
  });

  it('тот же профиль, вперёд ушли оба — развилку решает игрок', () => {
    expect(planCloudSync(local({ rev: 7 }), cloud({ rev: 9 }), true)).toBe('choose');
  });

  it('наша прошлая запись не дошла (облако отстало от сверки) — отправляем снова', () => {
    expect(planCloudSync(local({ rev: 6, syncedRev: 6 }), cloud({ rev: 4 }), true)).toBe('upload');
  });

  it('другой профиль: здесь пусто — берём облачный; здесь есть прогресс — решает игрок', () => {
    const other = cloud({ seed: 'account', rev: 40 });
    expect(planCloudSync(local({ hasProgress: false }), other, true)).toBe('adopt');
    expect(planCloudSync(local(), other, true)).toBe('choose');
  });
});

describe('YAG-2.2 — «есть что терять»', () => {
  const data = shippedGameData();
  it('свежий профиль — пусто; забег или любая валюта — уже прогресс', () => {
    const fresh = freshSectorZeroProgress(data, 's');
    expect(profileHasProgress(fresh)).toBe(false);
    expect(profileHasProgress({ ...fresh, nextAttempt: 2 })).toBe(true);
    expect(profileHasProgress({ ...fresh, sovereigns: 2 })).toBe(true);
    expect(profileHasProgress({ ...fresh, research: 1 })).toBe(true);
    expect(profileHasProgress({ ...fresh, warrants: 1 })).toBe(true);
  });
});

describe('YAG-2.2 — облачная запись: разбор', () => {
  it('туда и обратно без потерь, с дескриптором забега и без', () => {
    for (const p of [cloud(), cloud({ run: '{"v":1,"wave":3}' })]) {
      expect(parseCloudProfile(serializeCloudProfile(p))).toEqual(p);
    }
  });

  it('чужое и испорченное — «облака нет», а не падение', () => {
    for (const junk of [
      null,
      '',
      'not json',
      '[]',
      '{"v":2,"seed":"s","rev":1,"progress":"x"}',
      '{"v":1,"seed":"s","rev":-1,"progress":"x"}',
      '{"v":1,"seed":"s","rev":1.5,"progress":"x"}',
      '{"v":1,"seed":"s","rev":1,"progress":""}',
      '{"v":1,"rev":1,"progress":"x"}',
    ]) {
      expect(parseCloudProfile(junk)).toBeNull();
    }
  });

  it('пустой дескриптор забега не превращается в поле', () => {
    expect(parseCloudProfile(serializeCloudProfile(cloud({ run: '' })))).not.toHaveProperty('run');
  });
});

describe('YAG-2.2 — отметка сверки на устройстве', () => {
  it('читается как есть; мусор — «не сверялось»', () => {
    expect(parseSyncMark('{"rev":7,"syncedRev":5}')).toEqual({ rev: 7, syncedRev: 5 });
    for (const junk of [null, 'x', '{"rev":-1}', '{"rev":"7"}']) {
      expect(parseSyncMark(junk)).toEqual({ rev: 0, syncedRev: 0 });
    }
  });

  it('сверка не может быть впереди своей правки — срезается до неё', () => {
    expect(parseSyncMark('{"rev":3,"syncedRev":9}')).toEqual({ rev: 3, syncedRev: 3 });
  });
});

import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  adoptMark,
  bumpMark,
  cloudEnvelope,
  compareLineage,
  keepLocalMark,
  parseCloudProfile,
  parseSyncMark,
  planCloudSync,
  profileHasProgress,
  profileNumbers,
  serializeCloudProfile,
  type CloudProfile,
  type LocalSync,
  type SyncMark,
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

describe('AUD-24 — облако везёт ТОЧНЫЙ мир забега, а не только номер волны', () => {
  const world = '{"v":1,"mode":"pve_waves","state":{"time":123}}';

  it('снимок мира переживает облако туда и обратно рядом с дескриптором', () => {
    const p = cloud({ run: '{"v":1,"wave":9}', state: world });
    expect(parseCloudProfile(serializeCloudProfile(p))).toEqual(p);
  });

  it('пустой или не-строковый снимок — не поле: мусор не выдаётся за мир', () => {
    expect(parseCloudProfile(serializeCloudProfile(cloud({ state: '' })))).not.toHaveProperty('state');
    const raw = JSON.stringify({ ...cloud(), state: { time: 1 } });
    expect(parseCloudProfile(raw)).not.toHaveProperty('state');
  });

  it('влезает — конверт целиком, с миром', () => {
    const p = cloud({ run: '{"v":1,"wave":9}', state: world });
    expect(cloudEnvelope(p, () => true)).toBe(serializeCloudProfile(p));
    expect(cloudEnvelope(p)).toBe(serializeCloudProfile(p));
  });

  it('НЕ влезает в лимит площадки — уходит без мира, но профиль и дескриптор едут', () => {
    // Иначе площадка отвергла бы запись целиком, и на другом устройстве игрок нашёл бы
    // вчерашний профиль. Мир — копия того, что лежит локально; прогресс — нет.
    const p = cloud({ run: '{"v":1,"wave":9}', state: world });
    const sent = parseCloudProfile(cloudEnvelope(p, (e) => !e.includes('"state"')));
    expect(sent).toEqual(cloud({ run: '{"v":1,"wave":9}' }));
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

  it('YAG-4.4: флаг «уже запечатывало» живёт в отметке и переживает любую правку', () => {
    const mark = parseSyncMark('{"rev":3,"syncedRev":3,"device":"A","sealed":true}');
    expect(mark).toEqual({ rev: 3, syncedRev: 3, device: 'A', sealed: true });
    for (const junk of ['1', '"true"', 'false', 'null'])
      expect(parseSyncMark(`{"rev":3,"syncedRev":3,"sealed":${junk}}`)).not.toHaveProperty(
        'sealed',
      );
    expect(bumpMark(mark).sealed).toBe(true);
    expect(adoptMark(mark, { rev: 9 }).sealed).toBe(true);
    expect(keepLocalMark(mark, { rev: 9 }).sealed).toBe(true);
  });
});

describe('YAG-1.4 — развилка: «Оставить этот»', () => {
  // Устройство Б последним записало облако (правка 8) и с тех пор не играло.
  const deviceB = local({ seed: 's1', rev: 8, syncedRev: 8 });

  it('облако уходит ВПЕРЁД последней сверки Б — Б берёт выбор игрока, а не пишет поверх', () => {
    // Здесь правок меньше, чем в облаке: своим номером запись оказалась бы ПОЗАДИ облака,
    // и Б прочло бы её как «наша запись не дошла» и молча отправило свой профиль.
    const kept = keepLocalMark({ rev: 7, syncedRev: 5 }, { rev: 8 });
    expect(kept.rev).toBeGreaterThan(8);
    expect(planCloudSync(deviceB, cloud({ rev: kept.rev }), true)).toBe('adopt');
  });

  it('здесь правок больше, чем в облаке, — номер всё равно растёт', () => {
    expect(keepLocalMark({ rev: 20, syncedRev: 5 }, { rev: 8 }).rev).toBe(21);
  });

  it('отметка сверки — облако, которое игрок видел: не дойдёт запись — старт отправит снова', () => {
    const kept = keepLocalMark({ rev: 7, syncedRev: 5 }, { rev: 8 });
    expect(kept.syncedRev).toBe(8);
    // Запись не дошла: в облаке по-прежнему правка 8, а своя правка впереди.
    expect(planCloudSync({ ...local(), ...kept }, cloud({ rev: 8 }), true)).toBe('upload');
  });

  it('после выбора развилки нет: то же устройство на следующем старте видит «совпадает»', () => {
    const kept = keepLocalMark({ rev: 7, syncedRev: 5 }, { rev: 8 });
    const pushed = { ...local(), rev: kept.rev, syncedRev: kept.rev };
    expect(planCloudSync(pushed, cloud({ rev: kept.rev }), true)).toBe('same');
  });
});

describe('родословная: номера разных устройств — не одна история (ревью Sector Zero)', () => {
  // А и Б — один профиль (один сид) на двух устройствах. Отметка записи ставится ДО того,
  // как запись дошла: промис записи об успехе не сообщает.
  const markA = { rev: 10, syncedRev: 10, device: 'A', lineage: { A: 10 } };
  const markB = adoptMark({ rev: 3, syncedRev: 3, device: 'B' }, { rev: 10, lineage: { A: 10 } });
  const sync = (mark: SyncMark): LocalSync => ({ ...local(), ...mark });
  const envelope = (mark: { rev: number; lineage?: Record<string, number> }) =>
    cloud({ rev: mark.rev, ...(mark.lineage ? { lineage: mark.lineage } : {}) });

  it('воспроизведение: по голым номерам А молча «совпадает» и затирает правку Б', () => {
    // Прежнее правило, которое остаётся только для записей без родословной: так оно и
    // ошибалось, пока было единственным.
    expect(planCloudSync(local({ rev: 11, syncedRev: 11 }), cloud({ rev: 11 }), true)).toBe('same');
    expect(planCloudSync(local({ rev: 11, syncedRev: 11 }), cloud({ rev: 13 }), true)).toBe(
      'adopt',
    );
  });

  it('запись А пропала, Б записало ту же 11 — развилка, а не «совпадает»', () => {
    const a = { ...bumpMark(markA), syncedRev: 11 }; // отметил 11, запись не дошла
    const b = bumpMark(markB); // Б записал поверх облачной 10
    expect(b.rev).toBe(11);
    expect(planCloudSync(sync(a), envelope(b), true)).toBe('choose');
  });

  it('запись А пропала, Б записало трижды — развилка, а не молчаливое «взять облако»', () => {
    const a = { ...bumpMark(markA), syncedRev: 11 };
    const b = bumpMark(bumpMark(bumpMark(markB)));
    expect(planCloudSync(sync(a), envelope(b), true)).toBe('choose');
  });

  it('запись А дошла, Б взял её и продолжил — облако впереди, берём молча', () => {
    const a = bumpMark(markA);
    const b = bumpMark(adoptMark(markB, envelope(a)));
    expect(planCloudSync(sync(a), envelope(b), true)).toBe('adopt');
  });

  it('облако — наша же запись: та же — «совпадает», отставшая — отправляем снова', () => {
    const a = bumpMark(markA);
    expect(planCloudSync(sync(a), envelope(a), true)).toBe('same');
    expect(planCloudSync(sync(bumpMark(a)), envelope(a), true)).toBe('upload');
  });

  it('на развилке здесь терять нечего — берём облачный молча', () => {
    const a = { ...bumpMark(markA), syncedRev: 11 };
    const b = bumpMark(markB);
    expect(planCloudSync({ ...sync(a), hasProgress: false }, envelope(b), true)).toBe('adopt');
  });

  it('«Оставить этот» впереди ОБЕИХ веток: другое устройство берёт выбор, а не спрашивает', () => {
    const a = { ...bumpMark(markA), syncedRev: 11 };
    const b = bumpMark(markB);
    const kept = keepLocalMark(a, envelope(b));
    expect(compareLineage(kept.lineage!, b.lineage!)).toBe('ahead');
    expect(compareLineage(kept.lineage!, a.lineage!)).toBe('ahead');
    expect(planCloudSync(sync(b), envelope(kept), true)).toBe('adopt');
    expect(planCloudSync(sync(kept), envelope(kept), true)).toBe('same');
  });

  it('взятое облако не откатывает свой номер правки назад', () => {
    const adopted = adoptMark(
      { rev: 30, syncedRev: 30, device: 'B', lineage: { B: 30 } },
      {
        rev: 4,
        lineage: { A: 4 },
      },
    );
    expect(adopted.lineage).toEqual({ A: 4 });
    expect(bumpMark(adopted).lineage).toEqual({ A: 4, B: 31 });
  });

  it('облако без родословной — прежнее правило, а взятое оставляет устройство без неё', () => {
    const adopted = adoptMark({ rev: 2, syncedRev: 2, device: 'B', lineage: { B: 2 } }, { rev: 9 });
    expect(adopted).not.toHaveProperty('lineage');
    expect(planCloudSync(sync({ ...markA, lineage: { A: 10 } }), cloud({ rev: 12 }), true)).toBe(
      'adopt',
    );
  });

  it('сравнение родословных — четыре исхода', () => {
    expect(compareLineage({ A: 1 }, { A: 1 })).toBe('equal');
    expect(compareLineage({ A: 2 }, { A: 1 })).toBe('ahead');
    expect(compareLineage({ A: 1 }, { A: 1, B: 1 })).toBe('behind');
    expect(compareLineage({ A: 2 }, { A: 1, B: 1 })).toBe('forked');
  });

  it('родословная переживает запись и разбор; испорченная — как её нет', () => {
    const p = cloud({ lineage: { A: 3, B: 7 } });
    expect(parseCloudProfile(serializeCloudProfile(p))).toEqual(p);
    for (const junk of [[1], { A: -1 }, { A: 1.5 }, { A: '3' }, 'x'])
      expect(parseCloudProfile(JSON.stringify({ ...cloud(), lineage: junk }))).not.toHaveProperty(
        'lineage',
      );
  });

  it('отметка хранит имя устройства и родословную; без имени родословной нет', () => {
    const raw = JSON.stringify({ rev: 4, syncedRev: 4, device: 'A', lineage: { A: 4 } });
    expect(parseSyncMark(raw)).toEqual({ rev: 4, syncedRev: 4, device: 'A', lineage: { A: 4 } });
    expect(parseSyncMark(JSON.stringify({ rev: 4, lineage: { A: 4 } }))).toEqual({
      rev: 4,
      syncedRev: 0,
    });
    // Без имени устройства правка родословную не заводит: сверка идёт прежним правилом.
    expect(bumpMark({ rev: 1, syncedRev: 1 })).toEqual({ rev: 2, syncedRev: 1 });
  });
});

describe('YAG-1.4 — числа профиля на экране выбора', () => {
  it('забеги, главы и три валюты — как они лежат в профиле', () => {
    const p = {
      ...freshSectorZeroProgress(shippedGameData(), 's'),
      nextAttempt: 13,
      chaptersWon: ['a', 'b'],
      research: 340,
      warrants: 25,
      sovereigns: 7,
    };
    expect(profileNumbers(p)).toEqual({
      runs: 12,
      chapters: 2,
      research: 340,
      warrants: 25,
      sovereigns: 7,
    });
  });

  it('свежий профиль — ноль забегов, а не минус один', () => {
    expect(profileNumbers(freshSectorZeroProgress(shippedGameData(), 's')).runs).toBe(0);
  });
});

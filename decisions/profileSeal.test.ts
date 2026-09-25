import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import type { CloudProfile } from './cloudSync';
import {
  checkSeal,
  cloudSeal,
  LOCAL_SEAL,
  pickLocalProfile,
  sealProgress,
  SECTOR_ZERO_SHADOW_KEY,
  wholeCloud,
} from './profileSeal';
import {
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  SECTOR_ZERO_PROGRESS_KEY,
} from './sectorZeroProgress';

const data = shippedGameData();

/** Профиль середины игры: валюты, вложенные записи, списки. */
function midGame() {
  const p = freshSectorZeroProgress(data, 'seed-1');
  p.research = 640;
  p.warrants = 24;
  p.sovereigns = 35;
  p.nextAttempt = 7;
  p.settledThrough = 6;
  p.chaptersWon = ['pve-1'];
  p.objectivesDone = { 'pve-1': ['a', 'b'] };
  p.forgeTries = { ion_engine: 3 };
  return p;
}

/** Та же запись, но с ключами в обратном порядке — хранилище порядок не обещает. */
const reorder = (raw: string): string =>
  JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(raw) as object).reverse()));

/** Правка руками: поле профиля меняется, печать остаётся прежней. */
const edit = (raw: string, patch: Record<string, unknown>): string =>
  JSON.stringify({ ...(JSON.parse(raw) as object), ...patch });

describe('YAG-4.4 — печать: целый профиль узнаётся, правленый нет (замок 1)', () => {
  it('запечатанный профиль цел — и после смены порядка ключей', () => {
    const sealed = sealProgress(midGame(), LOCAL_SEAL);
    expect(checkSeal(sealed, LOCAL_SEAL)).toBe('sealed');
    expect(checkSeal(reorder(sealed), LOCAL_SEAL)).toBe('sealed');
    expect(checkSeal(sealProgress(freshSectorZeroProgress(data, ''), LOCAL_SEAL), LOCAL_SEAL)).toBe(
      'sealed',
    );
  });

  it('правка любого поля ломает печать: валюта, вложенная запись, лишнее и пропавшее поле', () => {
    const sealed = sealProgress(midGame(), LOCAL_SEAL);
    expect(checkSeal(edit(sealed, { sovereigns: 99999 }), LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(edit(sealed, { sovereigns: 36 }), LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(edit(sealed, { forgeTries: { ion_engine: 0 } }), LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(edit(sealed, { extra: 1 }), LOCAL_SEAL)).toBe('broken');
    const { research: _dropped, ...rest } = JSON.parse(sealed) as Record<string, unknown>;
    expect(checkSeal(JSON.stringify(rest), LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(edit(sealed, { seal: null }), LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(edit(sealed, { seal: 'ffffffffffffff' }), LOCAL_SEAL)).toBe('broken');
  });

  it('печать привязана: облачная копия другого игрока и локальная копия чужие друг другу', () => {
    const mine = sealProgress(midGame(), cloudSeal('u-1'));
    expect(checkSeal(mine, cloudSeal('u-1'))).toBe('sealed');
    expect(checkSeal(mine, cloudSeal('u-2'))).toBe('broken');
    expect(checkSeal(mine, LOCAL_SEAL)).toBe('broken');
    expect(checkSeal(sealProgress(midGame(), LOCAL_SEAL), cloudSeal('u-1'))).toBe('broken');
  });

  it('без печати — старая версия; нет записи — пусто; мусор — сломан, без исключений', () => {
    expect(checkSeal(JSON.stringify(midGame()), LOCAL_SEAL)).toBe('unsealed');
    expect(checkSeal(null, LOCAL_SEAL)).toBe('empty');
    expect(checkSeal('', LOCAL_SEAL)).toBe('empty');
    for (const raw of ['{broken', 'null', '[]', '42', '"text"', 'true', '[{"seal":"x"}]'])
      expect(checkSeal(raw, LOCAL_SEAL), raw).toBe('broken');
  });

  it('печать снимается с того, что вернёт JSON, и прежняя печать на входе не мешает', () => {
    const withUndefined = { ...midGame(), lastRun: undefined };
    expect(checkSeal(sealProgress(withUndefined, LOCAL_SEAL), LOCAL_SEAL)).toBe('sealed');
    const sealed = sealProgress(midGame(), LOCAL_SEAL);
    expect(sealProgress(JSON.parse(sealed) as object, LOCAL_SEAL)).toBe(sealed);
  });

  it('разбор профиля печать не видит: запечатанный читается как был', () => {
    const p = midGame();
    expect(parseSectorZeroProgress(sealProgress(p, LOCAL_SEAL), data, 'other')).toEqual(
      parseSectorZeroProgress(JSON.stringify(p), data, 'other'),
    );
  });

  it('ключ и правило печати не меняются молча — это сломало бы каждый сохранённый профиль', () => {
    // Золотые значения. Поменял ключ или правило — все профили без облака станут
    // «сломанными», и игроки потеряют прогресс. Меняй только вместе с переходом.
    const p = { v: 1, seed: 'golden', sovereigns: 5 };
    expect(sealProgress(p, LOCAL_SEAL)).toBe(
      '{"v":1,"seed":"golden","sovereigns":5,"seal":"14958ea4181790"}',
    );
    expect(sealProgress(p, cloudSeal('u-1'))).toBe(
      '{"v":1,"seed":"golden","sovereigns":5,"seal":"06cd3b05d5ef27"}',
    );
  });

  it('теневая копия лежит под своим ключом, рядом с основной', () => {
    expect(SECTOR_ZERO_SHADOW_KEY).not.toBe(SECTOR_ZERO_PROGRESS_KEY);
    expect(SECTOR_ZERO_SHADOW_KEY.startsWith('sector-zero.progress.')).toBe(true);
  });
});

describe('YAG-4.4 — правка не приживается: берётся последняя целая копия (замок 2)', () => {
  const good = sealProgress(midGame(), LOCAL_SEAL);
  const forged = edit(good, { sovereigns: 99999 });

  it('целая основная — она; тень догоняет, если отстала', () => {
    expect(pickLocalProfile(good, good, true)).toEqual({ raw: good, from: 'main', rewrite: false });
    expect(pickLocalProfile(good, null, true)).toEqual({ raw: good, from: 'main', rewrite: true });
    // Правка тени руками — тоже: основная цела, тень перепишется с неё.
    expect(pickLocalProfile(good, forged, true)).toEqual({
      raw: good,
      from: 'main',
      rewrite: true,
    });
  });

  it('правленая основная — берётся тень, и подделка стирается из хранилища', () => {
    expect(pickLocalProfile(forged, good, true)).toEqual({
      raw: good,
      from: 'shadow',
      rewrite: true,
    });
    expect(pickLocalProfile('{broken', good, true)).toEqual({
      raw: good,
      from: 'shadow',
      rewrite: true,
    });
    // Основная пропала, тень цела — профиль возвращается.
    expect(pickLocalProfile(null, good, true)).toEqual({
      raw: good,
      from: 'shadow',
      rewrite: true,
    });
  });

  it('снятая печать на устройстве, которое уже запечатывало, — та же правка', () => {
    const stripped = JSON.stringify({ ...(JSON.parse(forged) as object), seal: undefined });
    expect(checkSeal(stripped, LOCAL_SEAL)).toBe('unsealed');
    expect(pickLocalProfile(stripped, good, true)).toEqual({
      raw: good,
      from: 'shadow',
      rewrite: true,
    });
    expect(pickLocalProfile(stripped, null, true)).toEqual({
      raw: null,
      from: 'none',
      rewrite: false,
    });
  });

  it('целой копии нет вовсе — профиль начинается заново, правленый не берётся', () => {
    expect(pickLocalProfile(forged, forged, true)).toEqual({
      raw: null,
      from: 'none',
      rewrite: false,
    });
    expect(pickLocalProfile(forged, null, false)).toEqual({
      raw: null,
      from: 'none',
      rewrite: false,
    });
    expect(pickLocalProfile(null, null, false)).toEqual({
      raw: null,
      from: 'none',
      rewrite: false,
    });
    // Облачная копия, положенная в хранилище руками, локальной печати не имеет.
    const cloudCopy = sealProgress(midGame(), cloudSeal('u-1'));
    expect(pickLocalProfile(cloudCopy, null, true).from).toBe('none');
  });

  it('профиль старой версии без печати принимается и запечатывается — один раз', () => {
    const legacy = JSON.stringify(midGame());
    expect(pickLocalProfile(legacy, null, false)).toEqual({
      raw: legacy,
      from: 'legacy',
      rewrite: true,
    });
    // Разбор старого профиля даёт тот же прогресс — без потерь.
    expect(parseSectorZeroProgress(legacy, data, 'x')).toMatchObject({
      seed: 'seed-1',
      research: 640,
      warrants: 24,
      sovereigns: 35,
      nextAttempt: 7,
      chaptersWon: ['pve-1'],
    });
  });

  it('откат площадки на сборку без печати (AUD-31): новее то, что записала старая сборка', () => {
    // До отката: запечатанный профиль, тень и флаг. Старая сборка сохранила новый прогресс
    // без печати и переписала отметку без флага, а тень не тронула — та отстала.
    const before = sealProgress(midGame(), LOCAL_SEAL);
    const afterRollback = JSON.stringify({ ...midGame(), sovereigns: 40, nextAttempt: 8 });
    expect(pickLocalProfile(afterRollback, before, false)).toEqual({
      raw: afterRollback,
      from: 'legacy',
      rewrite: true,
    });
  });
});

describe('YAG-4.4 — облако не разносит подделку (замок 3)', () => {
  const envelope = (progress: string): CloudProfile => ({ v: 1, seed: 'seed-1', rev: 3, progress });

  it('принимается только копия, запечатанная для этого игрока', () => {
    const mine = envelope(sealProgress(midGame(), cloudSeal('u-1')));
    expect(wholeCloud(mine, 'u-1')).toBe(mine);
    expect(wholeCloud(mine, 'u-2')).toBeNull();
  });

  it('правленая, без печати, с локальной печатью или пустая — как «облака нет»', () => {
    const sealed = sealProgress(midGame(), cloudSeal('u-1'));
    expect(wholeCloud(envelope(edit(sealed, { sovereigns: 99999 })), 'u-1')).toBeNull();
    expect(wholeCloud(envelope(JSON.stringify(midGame())), 'u-1')).toBeNull();
    expect(wholeCloud(envelope(sealProgress(midGame(), LOCAL_SEAL)), 'u-1')).toBeNull();
    expect(wholeCloud(null, 'u-1')).toBeNull();
  });
});

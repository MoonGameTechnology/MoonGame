/**
 * Сверка профиля Sector Zero с облаком площадки (`YAG-2.2`) — чистое решение.
 *
 * Облако есть только у ВОШЕДШЕГО игрока; гость живёт локально (`YAG-1.4`). Вопрос этого
 * файла — что делать на старте, когда есть и локальный профиль, и облачный: отправить
 * свой, взять облачный, ничего не делать или спросить игрока.
 *
 * **Почему не «новее побеждает».** Резолюция владельца (`YAG-1.4`): автоматические
 * «облако побеждает» и «локальный побеждает» отклонены — оба молча уничтожают прогресс;
 * сложение счётчиков — тоже, оно удваивает валюту. Поэтому молча решается только то, где
 * потерять нечего, а всё остальное — один экран выбора (`choose`).
 *
 * **Как понять, где потерять нечего.** Два признака:
 * - `seed` — сид профиля, рождается один раз (`SectorZeroProgress.seed`). Один сид — одна
 *   родословная: тот же профиль на другом устройстве. Разные — это два разных профиля.
 * - номер правки `rev` растёт с каждым сохранением профиля, а устройство помнит
 *   `syncedRev` — номер облака, с которым оно сверялось в последний раз. Ушло вперёд
 *   только облако — его и берём; только устройство — отправляем; оба — развилка, и её
 *   решает игрок.
 */

import type { SectorZeroProgress } from './sectorZeroProgress';

/** Есть ли в профиле что терять: сыгранные забеги или любая из трёх валют. Свежий
 *  профиль уступает облачному молча — выбирать между «ничего» и прогрессом незачем. */
export const profileHasProgress = (
  p: Pick<SectorZeroProgress, 'nextAttempt' | 'research' | 'warrants' | 'sovereigns'>,
): boolean => p.nextAttempt > 1 || p.research > 0 || p.warrants > 0 || p.sovereigns > 0;

/** Числа профиля для экрана выбора (`YAG-1.4`): по ним игрок и решает, какой оставить. */
export interface ProfileNumbers {
  /** Начатые забеги: счётчик попыток растёт на старте забега. */
  runs: number;
  chapters: number;
  research: number;
  warrants: number;
  sovereigns: number;
}

export const profileNumbers = (
  p: Pick<
    SectorZeroProgress,
    'nextAttempt' | 'chaptersWon' | 'research' | 'warrants' | 'sovereigns'
  >,
): ProfileNumbers => ({
  runs: p.nextAttempt - 1,
  chapters: p.chaptersWon.length,
  research: p.research,
  warrants: p.warrants,
  sovereigns: p.sovereigns,
});

/** Что лежит в облаке. Профиль и дескриптор забега — строками в своём формате: их
 *  разбирают свои парсеры (`parseSectorZeroProgress`, `parsePortableRun`). */
export interface CloudProfile {
  v: 1;
  seed: string;
  rev: number;
  progress: string;
  run?: string;
}

/** Что устройство знает о себе. */
export interface LocalSync {
  seed: string;
  rev: number;
  /** Номер облака на последней сверке; 0 — не сверялось ни разу. */
  syncedRev: number;
  /** Есть ли в локальном профиле что терять (`profileHasProgress`). */
  hasProgress: boolean;
}

export type CloudPlan =
  /** Отправить свой профиль: облака нет, оно пустое или отстало. */
  | 'upload'
  /** Взять облачный: здесь терять нечего или вперёд ушло только облако. */
  | 'adopt'
  /** Уже совпадает. */
  | 'same'
  /** Прогресс есть с обеих сторон и разошёлся — решает игрок, облако не трогаем. */
  | 'choose';

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Разбор облачной записи. Чужая или испорченная запись — `null`, как «облака нет». */
export function parseCloudProfile(raw: string | null): CloudProfile | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const rev = count(o.rev);
  if (o.v !== 1 || typeof o.seed !== 'string' || rev === null) return null;
  if (typeof o.progress !== 'string' || o.progress.length === 0) return null;
  return {
    v: 1,
    seed: o.seed,
    rev,
    progress: o.progress,
    ...(typeof o.run === 'string' && o.run ? { run: o.run } : {}),
  };
}

export const serializeCloudProfile = (profile: CloudProfile): string => JSON.stringify(profile);

/**
 * Что делать на старте. `cloudHasProgress` считает вызывающий тем же правилом, что и
 * `local.hasProgress`, — по разобранному облачному профилю.
 */
export function planCloudSync(
  local: LocalSync,
  cloud: CloudProfile | null,
  cloudHasProgress: boolean,
): CloudPlan {
  if (!cloud || !cloudHasProgress) return 'upload';
  if (cloud.seed !== local.seed) return local.hasProgress ? 'choose' : 'adopt';
  if (cloud.rev > local.syncedRev) return local.rev > local.syncedRev ? 'choose' : 'adopt';
  // Облако не дальше последней сверки: либо совпадает, либо наша запись до него не дошла.
  return local.rev > cloud.rev ? 'upload' : 'same';
}

/** Локальная отметка сверки: номер своей правки и номер облака на последней сверке. */
export interface SyncMark {
  rev: number;
  syncedRev: number;
}

/** Разбор отметки. Мусор — «не сверялось», а не падение. */
export function parseSyncMark(raw: string | null): SyncMark {
  try {
    const o = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    const rev = count(o?.rev) ?? 0;
    const syncedRev = Math.min(count(o?.syncedRev) ?? 0, rev);
    return { rev, syncedRev };
  } catch {
    return { rev: 0, syncedRev: 0 };
  }
}

/**
 * «Оставить этот» на развилке (`YAG-1.4`): отметка, с которой локальный профиль заменит
 * облачный. «Взять из облака» отдельного правила не требует — это `adopt`.
 *
 * Номер правки — ВПЕРЕДИ облачного, а не свой. Другое устройство последний раз сверялось
 * с `cloudRev`; запиши мы свой номер, а он меньше, — облако окажется ПОЗАДИ его сверки, и
 * `planCloudSync` прочтёт это как «наша запись не дошла»: то устройство молча отправит
 * свой профиль поверх выбора игрока. Отметка сверки — облако, которое игрок видел: не
 * дойдёт запись — следующий старт отправит профиль снова.
 */
export function keepLocalMark(mark: SyncMark, cloudRev: number): SyncMark {
  return { rev: Math.max(mark.rev, cloudRev) + 1, syncedRev: cloudRev };
}

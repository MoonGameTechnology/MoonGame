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
 * - **родословная** `lineage` — для каждого устройства последний ЕГО номер правки, который
 *   вошёл в этот профиль (вектор версий). Номер правки у каждого устройства свой, поэтому
 *   сравниваются родословные, а не голые номера: в одной есть всё из другой — вперёд ушла
 *   она; у каждой есть своё — развилка, и её решает игрок.
 *
 * **Почему не один номер на всех.** Раньше номер правки `rev` сравнивался с отметкой
 * `syncedRev` как ОДНА история, хотя номера пишут разные устройства, а отметка ставится
 * до того, как запись дошла (промис записи об успехе не сообщает). Устройство А отметило
 * правку 11, запись пропала; Б взяло облачную 10 и записало свою 11. На старте А видело
 * «облако 11 = моя сверка 11» и молча отвечало «совпадает», а следующее сохранение
 * затирало прогресс Б. Запиши Б трижды — А так же молча брало облако и теряло свою
 * правку. Родословная `{А:11}` против `{А:10, Б:11}` — развилка в обоих случаях.
 *
 * Запись без родословной (сохранена до неё) сверяется прежним правилом по номерам: такое
 * бывает один раз, до первого сохранения после обновления.
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

/** Родословная профиля: устройство → последний его номер правки, вошедший в профиль. */
export type Lineage = Record<string, number>;

/** Что лежит в облаке. Профиль, дескриптор и снимок забега — строками в своём формате:
 *  их разбирают свои парсеры (`parseSectorZeroProgress`, `parsePortableRun`,
 *  `parseRunSave`). */
export interface CloudProfile {
  v: 1;
  seed: string;
  rev: number;
  progress: string;
  run?: string;
  /**
   * Точный мир идущего забега — тот же блоб, что лежит локально (`runSave.ts`). AUD-24:
   * без него другое устройство продолжало забег по дескриптору, то есть пересобирало мир
   * с карты главы, — и «Продолжить» там было перемоткой поражения: дом цел, наступление
   * Роя стёрто. Нет поля — запись сделана раньше или мир не влез в лимит площадки
   * ({@link cloudEnvelope}); тогда остаётся дескриптор.
   */
  state?: string;
  /** Нет — запись сделана до родословных. */
  lineage?: Lineage;
}

/** Что устройство знает о себе. */
export interface LocalSync {
  seed: string;
  rev: number;
  /** Номер облака на последней сверке; 0 — не сверялось ни разу. */
  syncedRev: number;
  /** Есть ли в локальном профиле что терять (`profileHasProgress`). */
  hasProgress: boolean;
  /** Родословная локального профиля; нет — ещё не сохранялся после обновления. */
  lineage?: Lineage;
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

/** Разбор родословной. Испорченная — как её отсутствие: сверка уйдёт в прежнее правило,
 *  а не примет мусор за историю. */
function parseLineage(value: unknown): Lineage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Lineage = {};
  for (const [device, rev] of Object.entries(value as Record<string, unknown>)) {
    const n = count(rev);
    if (!device || n === null) return undefined;
    out[device] = n;
  }
  return out;
}

/** Как родословная `a` относится к `b`: та же, впереди (есть всё из `b` и больше),
 *  позади или развилка (у каждой есть своё). */
export function compareLineage(a: Lineage, b: Lineage): 'equal' | 'ahead' | 'behind' | 'forked' {
  let ahead = false;
  let behind = false;
  for (const device of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[device] ?? 0;
    const y = b[device] ?? 0;
    if (x > y) ahead = true;
    if (x < y) behind = true;
  }
  return ahead ? (behind ? 'forked' : 'ahead') : behind ? 'behind' : 'equal';
}

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
  const lineage = parseLineage(o.lineage);
  return {
    v: 1,
    seed: o.seed,
    rev,
    progress: o.progress,
    ...(typeof o.run === 'string' && o.run ? { run: o.run } : {}),
    ...(typeof o.state === 'string' && o.state ? { state: o.state } : {}),
    ...(lineage ? { lineage } : {}),
  };
}

export const serializeCloudProfile = (profile: CloudProfile): string => JSON.stringify(profile);

/**
 * Конверт для облака с оглядкой на лимит площадки (AUD-24). Мир забега — самая тяжёлая
 * часть конверта (замер: до 36 КБ в главе II при лимите `setData` 200 КБ), и если он всё
 * же не влез, конверт уходит БЕЗ него, а не отвергается целиком: площадка иначе не
 * получила бы и профиль, и другое устройство нашло бы вчерашний прогресс. Мир — копия
 * того, что лежит локально; профиль — нет. `fits` отвечает площадка (`PlatformSave`):
 * своего правила подсчёта байт здесь нет.
 */
export function cloudEnvelope(
  profile: CloudProfile,
  fits: (envelope: string) => boolean = () => true,
): string {
  const full = serializeCloudProfile(profile);
  if (profile.state === undefined || fits(full)) return full;
  const { state: _dropped, ...rest } = profile;
  return serializeCloudProfile(rest);
}

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
  if (cloud.lineage && local.lineage) {
    const order = compareLineage(local.lineage, cloud.lineage);
    if (order === 'equal') return 'same';
    if (order === 'ahead') return 'upload';
    if (order === 'behind') return 'adopt';
    return local.hasProgress ? 'choose' : 'adopt';
  }
  // Прежнее правило — для записи без родословной (см. шапку).
  if (cloud.rev > local.syncedRev) return local.rev > local.syncedRev ? 'choose' : 'adopt';
  // Облако не дальше последней сверки: либо совпадает, либо наша запись до него не дошла.
  return local.rev > cloud.rev ? 'upload' : 'same';
}

/** Локальная отметка сверки: номер своей правки, номер облака на последней сверке, имя
 *  устройства и родословная локального профиля. Имя выдаёт хост (случайное, один раз):
 *  здесь случайности нет. */
export interface SyncMark {
  rev: number;
  syncedRev: number;
  device?: string;
  lineage?: Lineage;
}

/** Разбор отметки. Мусор — «не сверялось», а не падение. */
export function parseSyncMark(raw: string | null): SyncMark {
  try {
    const o = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    const rev = count(o?.rev) ?? 0;
    const syncedRev = Math.min(count(o?.syncedRev) ?? 0, rev);
    const device = typeof o?.device === 'string' && o.device ? o.device : undefined;
    const lineage = device ? parseLineage(o?.lineage) : undefined;
    return { rev, syncedRev, ...(device ? { device } : {}), ...(lineage ? { lineage } : {}) };
  } catch {
    return { rev: 0, syncedRev: 0 };
  }
}

/** Родословная с новой правкой этого устройства. Без имени устройства — как была. */
const withOwn = (mark: SyncMark, rev: number, base?: Lineage): Lineage | undefined =>
  mark.device ? { ...base, [mark.device]: rev } : base;

/** Профиль сохранён — новая правка этого устройства. */
export function bumpMark(mark: SyncMark): SyncMark {
  const rev = mark.rev + 1;
  const lineage = withOwn(mark, rev, mark.lineage);
  return { ...mark, rev, ...(lineage ? { lineage } : {}) };
}

/**
 * Облачный профиль взят: родословная — ровно облачная. Свой номер правки не откатывается
 * назад — иначе следующая правка этого устройства повторила бы номер, который уже мог
 * попасть в чью-то родословную.
 */
export function adoptMark(mark: SyncMark, cloud: Pick<CloudProfile, 'rev' | 'lineage'>): SyncMark {
  const rev = Math.max(mark.rev, cloud.rev);
  const next: SyncMark = { ...mark, rev, syncedRev: rev };
  if (cloud.lineage) next.lineage = { ...cloud.lineage };
  else delete next.lineage;
  return next;
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
 *
 * Родословная — обе ветки развилки и новая правка сверху: выбор игрока «впереди» и
 * облачной ветки, и своей, поэтому другое устройство его возьмёт, а не спросит снова.
 */
export function keepLocalMark(
  mark: SyncMark,
  cloud: Pick<CloudProfile, 'rev' | 'lineage'>,
): SyncMark {
  const rev = Math.max(mark.rev, cloud.rev) + 1;
  const merged: Lineage = { ...cloud.lineage };
  for (const [device, n] of Object.entries(mark.lineage ?? {}))
    merged[device] = Math.max(merged[device] ?? 0, n);
  const lineage = withOwn(mark, rev, merged);
  return {
    ...mark,
    rev,
    syncedRev: cloud.rev,
    ...(lineage && Object.keys(lineage).length ? { lineage } : {}),
  };
}
